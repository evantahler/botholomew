import {
  type Action,
  type ActionMiddleware,
  api,
  Connection,
  ErrorType,
  HTTP_METHOD,
  TypedError,
} from "keryx";
import type { z } from "zod";
import type { RbacConnectionMeta } from "../middleware/rbac";
import type { SessionImpl } from "../middleware/session";
import { insertAuditLog } from "../ops/AuditOps";
import type { TxHandle } from "../ops/ProjectOps";

export type { TxHandle };

/** The connection shape every audited action receives: a session plus audit metadata. */
export type AuditedConnection = Connection<SessionImpl, RbacConnectionMeta>;

/**
 * Fields Postgres (and node-postgres / postgres.js / Bun.sql) hang on a driver
 * error. Drizzle wraps the query in `new Error("Failed query: …")` and puts the
 * driver error in `error.cause`, which is why a log of `e.message` alone is the
 * SQL text with no hint about *why* it failed.
 */
const DRIVER_ERROR_FIELDS = [
  "code",
  "detail",
  "hint",
  "constraint",
  "severity",
  "routine",
  "schema",
  "table",
  "column",
  "dataType",
  "errno",
] as const;

/**
 * Shape an unexpected failure for the logger, including the driver `cause`
 * chain that Drizzle otherwise hides.
 * @param e - Whatever was thrown.
 * @returns A JSON-serializable log payload.
 */
export function unexpectedErrorLog(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) {
    return { error: String(e) };
  }

  const causes: Record<string, unknown>[] = [];
  let current: unknown = e;
  for (let depth = 0; current instanceof Error && depth < 6; depth++) {
    const entry: Record<string, unknown> = {
      name: current.name,
      error: current.message,
    };
    if (depth > 0 && current.stack) entry.stack = current.stack;
    for (const field of DRIVER_ERROR_FIELDS) {
      const value = (current as unknown as Record<string, unknown>)[field];
      if (value !== undefined) entry[field] = value;
    }
    if (depth > 0) causes.push(entry);
    current = current.cause;
  }
  if (
    current !== undefined &&
    current !== null &&
    !(current instanceof Error)
  ) {
    causes.push({ error: String(current) });
  }

  return {
    error: e.message,
    stack: e.stack,
    ...(causes.length > 0 ? { cause: causes[0], causes } : {}),
  };
}

/**
 * Base class for every **mutating** action. It runs the subclass's writes and the
 * audit-log insert inside a single `api.db.db.transaction`, so the audit row and
 * the change it describes always commit — or roll back — together. There is no
 * after-the-fact writer, no queue, and no best-effort hook: the log cannot
 * disagree with what was persisted, because the two are the same commit.
 *
 * Subclasses implement {@link AuditedAction.runWithAudit} instead of `run`, route
 * every insert/update/delete through the provided `tx`, and set
 * `connection.metadata.auditBefore` (a pre-mutation snapshot read inside the same
 * transaction) and `connection.metadata.auditAfter` (the serialized result), so
 * the audit row captures state atomically with the write.
 *
 * Read-only actions (`*:view`, `*:list`) and sweep tasks stay plain `Action`s
 * and are not audited — a retention sweep is not somebody's decision.
 */
export abstract class AuditedAction implements Action {
  abstract name: string;
  abstract description: string;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors keryx's own `Action.inputs` type.
  abstract inputs: z.ZodType<any>;
  abstract middleware: ActionMiddleware[];
  abstract web: { route: string; method: HTTP_METHOD };

  /**
   * Open one transaction, run the subclass mutation, write the audit row on the
   * same transaction, and commit. Any error rolls back both. Non-`TypedError`
   * failures are rewrapped so callers always see a typed error.
   * @param params - The validated action inputs.
   * @param connection - The caller's connection (session + audit metadata).
   * @returns Whatever {@link AuditedAction.runWithAudit} returns.
   * @throws {TypedError} The subclass's own typed errors, or a generic
   *   `CONNECTION_ACTION_RUN` for anything else.
   */
  async run(
    params: Record<string, unknown>,
    connection: AuditedConnection,
  ): Promise<Awaited<ReturnType<this["runWithAudit"]>>> {
    // Connections — long-lived MCP sessions above all — are reused across acts,
    // so a previous action's snapshots would otherwise leak into this row.
    connection.metadata.auditBefore = undefined;
    connection.metadata.auditAfter = undefined;
    connection.metadata.auditMetadata = undefined;
    connection.metadata.auditProjectId = undefined;
    connection.metadata.auditTargetType = undefined;
    connection.metadata.auditTargetPath = undefined;

    try {
      const result = await api.db.db.transaction(async (tx) => {
        const value = await this.runWithAudit(tx, params, connection);
        await insertAuditLog(tx, this.name, connection, params);
        return value;
      });

      // Post-commit side effects run only after the change durably commits, and
      // never fail the action — the write already succeeded, so surfacing a hook
      // error as a failed request would be a lie about what happened.
      if (this.afterCommit) {
        try {
          await this.afterCommit(result, params, connection);
        } catch (hookError) {
          api.logger.warn(`afterCommit hook failed for ${this.name}`, {
            error:
              hookError instanceof Error
                ? hookError.message
                : String(hookError),
          });
        }
      }

      // `runWithAudit` is declared `Promise<unknown>` on the base but narrowed by
      // every subclass — recover the concrete response type for callers, and for
      // `ActionResponse<T>`, which the frontend derives from this method.
      return result as Awaited<ReturnType<this["runWithAudit"]>>;
    } catch (e) {
      if (e instanceof TypedError) throw e;
      // Anything untyped (a Postgres constraint violation, say) becomes a generic
      // typed error for the caller — but log the original first, or the cause is
      // unrecoverable from the response alone.
      api.logger.error(
        `${this.name} failed with an unexpected error`,
        unexpectedErrorLog(e),
      );
      throw new TypedError({
        message: "An unexpected error occurred",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }
  }

  /**
   * Perform the action's writes on `tx` and record the audit snapshots on
   * `connection.metadata`. Must not open its own transaction — the base owns it,
   * and a nested one would defeat the atomicity this class exists to provide.
   * @param tx - The open Drizzle transaction the mutation and audit row share.
   * @param params - The validated action inputs.
   * @param connection - The caller's connection (session + audit metadata).
   * @returns The action's response object.
   */
  abstract runWithAudit(
    tx: TxHandle,
    params: Record<string, unknown>,
    connection: AuditedConnection,
  ): Promise<unknown>;

  /**
   * Optional post-commit side effect. Runs once, after the audited transaction
   * has durably committed, with the action's result. Use it for effects that must
   * not happen on rollback and must not fail the write — enqueuing a background
   * job is the canonical case.
   * Errors are logged and swallowed.
   * @param result - The value returned by {@link AuditedAction.runWithAudit}.
   * @param params - The validated action inputs.
   * @param connection - The caller's connection (session + audit metadata).
   */
  afterCommit?(
    result: unknown,
    params: Record<string, unknown>,
    connection: AuditedConnection,
  ): Promise<void>;
}
