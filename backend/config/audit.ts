import { loadFromEnvIfSet } from "keryx";

/**
 * Audit-log configuration. `retentionDays` bounds how long audit rows are kept
 * before `audit:sweep` deletes them; override with `AUDIT_RETENTION_DAYS`.
 *
 * 90 days. The audit log is the record of who changed a project's members,
 * tags, and settings, which is the kind of question that gets asked a quarter
 * after the fact, when something starts behaving differently and nobody remembers
 * touching anything. A row carries no foreign key to its project, so it outlives
 * the subject it describes; this window is the only thing that removes it.
 */
export const configAudit = {
  retentionDays: await loadFromEnvIfSet("AUDIT_RETENTION_DAYS", 90),
};

declare module "keryx" {
  interface KeryxConfig {
    audit: typeof configAudit;
  }
}
