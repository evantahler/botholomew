import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import {
  type Action,
  type ActionParams,
  api,
  HTTP_METHOD,
  paginate,
  paginationInputs,
} from "keryx";
import { z } from "zod";
import { AdminMiddleware } from "../../middleware/rbac";
import { serializeAuditLog } from "../../ops/AuditOps";
import { auditLogs } from "../../schema/audit_logs";

/**
 * A timestamp accepted as either an ISO-8601 string or epoch milliseconds.
 *
 * `z.coerce.date()` alone is not enough, and the gap is easy to miss: it calls
 * `new Date(value)`, and every query-string param arrives as a *string*, so
 * `?since=1754000000000` becomes `new Date("1754000000000")` — an Invalid Date,
 * not the instant meant. The preprocessing step turns an all-digits string into a
 * number first, which is what makes the epoch form work over HTTP at all.
 * @param description - The `.describe()` text for this field.
 * @returns A Zod schema producing a `Date`.
 */
function timestampInput(description: string) {
  return z
    .preprocess(
      (value) =>
        typeof value === "string" && /^\d+$/.test(value)
          ? Number(value)
          : value,
      z.coerce.date(),
    )
    .describe(description);
}

/**
 * `audit:list` — a project's audit-log entries within a time range, newest first.
 * Requires the admin tag: the log names who did what, which is administrative
 * information rather than something every member should read.
 *
 * `since` / `until` are `z.coerce.date()`, so an ISO-8601 string and epoch
 * milliseconds both work — the frontend sends ISO, a `curl` sends epoch. The
 * optional `action` filter is an exact match on the action name: with members,
 * tags, and invites all writing rows, "show me every `tag:edit` in this project"
 * is the query an admin actually has.
 */
export class AuditList implements Action {
  name = "audit:list";
  description =
    "List a project's audit-log entries within a time range, most recent first, optionally filtered to a single action name. Requires the admin tag on the project. Paginated.";
  middleware = [AdminMiddleware()];
  web = { route: "/audit-logs", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 }).extend({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project whose audit logs to list"),
    since: timestampInput(
      "Start of the time range (inclusive), as an ISO-8601 timestamp or epoch milliseconds",
    ),
    until: timestampInput(
      "End of the time range (inclusive), as an ISO-8601 timestamp or epoch milliseconds. Defaults to now.",
    ).optional(),
    action: z
      .string()
      .optional()
      .describe(
        "Only return entries for this exact action name, e.g. 'tag:edit'",
      ),
  });

  /**
   * @param params - `projectId`, `since`, optional `until` and `action`, plus pagination.
   * @returns The matching audit-log entries and pagination metadata.
   */
  async run(params: ActionParams<AuditList>) {
    const until = params.until ?? new Date();
    const where = and(
      eq(auditLogs.projectId, params.projectId),
      gte(auditLogs.createdAt, params.since),
      lte(auditLogs.createdAt, until),
      params.action ? eq(auditLogs.action, params.action) : undefined,
    );

    const result = await paginate(
      api.db.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .$dynamic(),
      api.db.db.select({ count: count() }).from(auditLogs).where(where),
      params,
    );

    return {
      auditLogs: result.data.map(serializeAuditLog),
      pagination: result.pagination,
    };
  }
}
