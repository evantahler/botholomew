import { z } from "zod";

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "failed",
  "complete",
  "waiting",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Frontmatter validator for `tasks/<id>.md`. Strict so a hand-edited or stale
 * file doesn't silently round-trip with bad data; a parse failure quarantines
 * the file (skip claim, log) per the doctor policy.
 */
export const TaskFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(""),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  status: z.enum(TASK_STATUSES).default("pending"),
  blocked_by: z.array(z.string()).default([]),
  context_paths: z.array(z.string()).default([]),
  output: z.string().nullable().default(null),
  waiting_reason: z.string().nullable().default(null),
  claimed_by: z.string().nullable().default(null),
  claimed_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

/**
 * In-memory task representation: frontmatter parsed + filesystem mtime so
 * callers can detect concurrent edits before committing a write.
 */
export interface Task extends TaskFrontmatter {
  /** Filesystem mtime in epoch ms, used for atomic-write-if-unchanged. */
  mtimeMs: number;
  /** Markdown body (everything after the frontmatter). */
  body: string;
}
