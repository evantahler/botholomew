import { lt } from "drizzle-orm";
import { type Action, api, config } from "keryx";
import { z } from "zod";
import { auditLogs } from "../../schema/audit_logs";

/**
 * `audit:sweep` — a daily background sweeper deleting audit rows older than
 * `config.audit.retentionDays`. Task-only: not exposed over HTTP.
 *
 * A plain `Action`, deliberately: a retention sweep is the schedule acting, not a
 * person, so auditing it would only add a row per day describing the removal of
 * rows. `mcp = { tool: false }` because it is operational, not something a
 * person's assistant should hold.
 */
export class AuditSweep implements Action {
  name = "audit:sweep";
  description =
    "Delete audit-log entries older than the configured retention period. Runs automatically once per day; not exposed over HTTP.";
  mcp = { tool: false };
  task = { queue: "default", frequency: 1000 * 60 * 60 * 24 };
  inputs = z.object({});

  /**
   * Delete every audit-log entry older than the retention cutoff.
   * @returns The number of entries deleted.
   */
  async run() {
    const cutoff = new Date(
      Date.now() - config.audit.retentionDays * 24 * 60 * 60 * 1000,
    );
    const deleted = await api.db.db
      .delete(auditLogs)
      .where(lt(auditLogs.createdAt, cutoff))
      .returning({ id: auditLogs.id });

    return { deleted: deleted.length };
  }
}
