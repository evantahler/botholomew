import { api, type Connection } from "keryx";
import type { RbacConnectionMeta } from "../middleware/rbac";
import type { SessionImpl } from "../middleware/session";
import { type AuditLog, auditLogs } from "../schema/audit_logs";
import type { TxHandle } from "./ProjectOps";

/**
 * Param keys whose values may carry a secret and must never reach an audit row's
 * `metadata` column.
 *
 * This is the second of **two** layers, not the only one: `before` / `after` are
 * always `serializeX()` output, and those serializers already drop hashes and
 * secrets. This denylist covers the other side — the raw action params, which
 * `insertAuditLog` stores verbatim by default.
 *
 * The list names more keys than the shell's own actions take, because the
 * secrets Botholomew is built to hold — model provider keys (`apiKey`), MCP
 * server credentials (`token`, `secret`, `secretValue`), and connection strings —
 * would otherwise land in `metadata` in plaintext the first time an action
 * accepted one. A new secret-bearing param means adding its key here in the same
 * commit.
 */
export const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "password_hash",
  "secret",
  "secretValue",
  "token",
  "apiKey",
  "connectionString",
] as const;

/**
 * Return a copy of an action's params with every {@link SENSITIVE_KEYS} entry
 * removed at any depth, so secrets never land in an audit row's `metadata`.
 *
 * Recursion is the load-bearing part for nested documents. A shallow scrub
 * would leave `document.connections[].secret` in the row while looking like it
 * had done the job — the same failure mode as a denylist of top-level names.
 * @param params - The raw action params.
 * @returns A copy of `params` safe to persist as audit metadata.
 */
export function scrubParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return scrubValue(params) as Record<string, unknown>;
}

/**
 * Strip {@link SENSITIVE_KEYS} from a JSON-like value, walking arrays and
 * objects. Non-plain values (dates, class instances) are returned as-is —
 * action params are JSON, and this is not a general deep clone.
 * @param value - Any JSON-like value.
 * @returns The scrubbed copy.
 */
function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if ((SENSITIVE_KEYS as readonly string[]).includes(key)) continue;
      out[key] = scrubValue(child);
    }
    return out;
  }
  return value;
}

/** An explicit audit-log entry, for writers that do not go through an action's `run`. */
export interface AuditLogEntry {
  userId?: number | null;
  projectId?: number | null;
  /** The bot that made the change, when a bot made it. */
  actorBotId?: number | null;
  /** The person whose message caused a bot's change, when there was one. */
  onBehalfOfUserId?: number | null;
  action: string;
  targetType?: string | null;
  targetPath?: string | null;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
}

/**
 * Write one audit-log row from explicit fields.
 *
 * This exists for changes made inside a **shared ops helper**, which are invisible
 * to the calling action's own auditing. The signup bootstrap is one: it runs
 * `createProjectForOwner`, so `user:create` logs a synthetic `project:create`
 * row scoped to the new project. A bot's change to shared state is the other
 * kind this is for, with `actorBotId` (and `onBehalfOfUserId`, when a person's
 * message caused it) set. Pass the caller's transaction handle as `db` so the
 * row commits atomically with the change it describes.
 * @param db - A Drizzle transaction handle, or the shared `api.db.db`.
 * @param entry - The audit-log fields to persist.
 */
export async function writeAuditLog(
  db: TxHandle | typeof api.db.db,
  entry: AuditLogEntry,
): Promise<void> {
  await db.insert(auditLogs).values({
    userId: entry.userId ?? null,
    projectId: entry.projectId ?? null,
    actorBotId: entry.actorBotId ?? null,
    onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetPath: entry.targetPath ?? null,
    metadata: entry.metadata ?? {},
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/**
 * Insert the audit row describing a mutating action. Called by
 * `AuditedAction.run` on the same transaction as the mutation.
 *
 * Everything the row cannot infer from the action itself comes off
 * `connection.metadata`, which the acting subclass sets: the `before` / `after`
 * snapshots, the target, and — for the few actions whose params do not name a
 * project — the `projectId` to scope the row to. `metadata` defaults to the
 * secret-scrubbed params.
 * @param db - A Drizzle transaction handle, or the shared `api.db.db`.
 * @param actionName - The action's `name`, e.g. `"tag:edit"`.
 * @param connection - The caller's connection (session + audit metadata).
 * @param params - The action params (scrubbed of secrets before storage).
 */
export async function insertAuditLog(
  db: TxHandle | typeof api.db.db,
  actionName: string,
  connection: Connection<SessionImpl, RbacConnectionMeta>,
  params: Record<string, unknown>,
): Promise<void> {
  const meta = connection.metadata;

  await writeAuditLog(db, {
    userId: connection.session?.data.userId ?? null,
    projectId: meta.auditProjectId ?? (params.projectId as number) ?? null,
    action: actionName,
    targetType: meta.auditTargetType ?? null,
    targetPath: meta.auditTargetPath ?? null,
    metadata: meta.auditMetadata ?? scrubParams(params),
    before: meta.auditBefore ?? null,
    after: meta.auditAfter ?? null,
  });
}

/**
 * Shape an audit-log row into the API-safe object returned by `audit:list`.
 * `createdAt` is emitted as epoch milliseconds, per the serializer convention;
 * `metadata` / `before` / `after` pass through as stored, which is safe because
 * both layers of redaction already ran at write time.
 * @param row - The audit-log row from the database.
 * @returns The serialized audit-log entry.
 */
export function serializeAuditLog(row: AuditLog) {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    actorBotId: row.actorBotId,
    onBehalfOfUserId: row.onBehalfOfUserId,
    action: row.action,
    targetType: row.targetType,
    targetPath: row.targetPath,
    metadata: row.metadata,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.getTime(),
  };
}
