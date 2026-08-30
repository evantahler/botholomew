import { z } from "zod";

export const APPROVAL_STATUSES = ["pending", "approved", "denied"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Frontmatter validator for `approvals/<id>.md`. An approval record describes a
 * single gated mcpx tool call a worker wanted to make. Strict so a hand-edited
 * or stale file doesn't silently round-trip with bad data; a parse failure
 * quarantines the file (skip, log) the same way tasks/schedules do.
 *
 * `call_key` is a stable hash of (server, tool, args) so a re-run of the same
 * task can match the human's decision to the concrete call that was approved.
 */
export const ApprovalFrontmatterSchema = z.object({
  id: z.string().min(1),
  status: z.enum(APPROVAL_STATUSES).default("pending"),
  server: z.string(),
  tool: z.string(),
  /** JSON-encoded tool arguments (kept as a string to avoid nested-YAML quirks). */
  args: z.string().default("{}"),
  /** Stable hash of server+tool+args; how a re-run matches a prior decision. */
  call_key: z.string(),
  /** Originating task/thread/worker — null when the request came from chat. */
  task_id: z.string().nullable().default(null),
  thread_id: z.string().nullable().default(null),
  worker_id: z.string().nullable().default(null),
  /** Human-readable label for why the gate fired (e.g. "not-allowlisted"). */
  reason: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
  decided_at: z.string().nullable().default(null),
  decided_by: z.string().nullable().default(null),
  /**
   * When this gate fired from a `membot_run` sandbox, the id of the stored
   * continuation (sibling `approvals/<run_id>.run.json`).
   */
  run_id: z.string().nullable().default(null),
  /** Run SDK interruption id this record resolves, when `run_id` is set. */
  interruption_id: z.string().nullable().default(null),
});

export type ApprovalFrontmatter = z.infer<typeof ApprovalFrontmatterSchema>;

/**
 * In-memory approval representation: frontmatter parsed + filesystem mtime so
 * callers can detect concurrent edits before committing a write.
 */
export interface Approval extends ApprovalFrontmatter {
  /** Filesystem mtime in epoch ms, used for atomic-write-if-unchanged. */
  mtimeMs: number;
  /** Markdown body (everything after the frontmatter). */
  body: string;
}
