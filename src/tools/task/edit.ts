import { z } from "zod";
import {
  atomicWriteIfUnchanged,
  MtimeConflictError,
  readWithMtime,
} from "../../fs/atomic.ts";
import { applyLinePatches, LinePatchSchema } from "../../fs/patches.ts";
import type { TaskFrontmatter } from "../../tasks/schema.ts";
import {
  CircularDependencyError,
  parseTaskFile,
  serializeTask,
  taskFilePath,
  validateBlockedBy,
} from "../../tasks/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("Task id"),
  patches: z.array(LinePatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  id: z.string(),
  path: z.string().nullable(),
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const taskEditTool = {
  name: "task_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply git-style line-range patches to a task file. Operates on the whole file (frontmatter + body). Only pending tasks may be edited. Patches that fail validation or introduce a circular dependency are rejected without writing. Re-serializes to canonicalize YAML and bump updated_at.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const filePath = taskFilePath(ctx.projectDir, input.id);
    const file = await readWithMtime(filePath);
    if (!file) {
      return {
        id: input.id,
        path: null,
        applied: 0,
        content: "",
        is_error: true,
        error_type: "not_found",
        message: `Task not found: ${input.id}`,
        next_action_hint:
          "Use list_tasks to see available tasks, or create_task to make one.",
      };
    }

    const original = file.content;
    const preParsed = parseTaskFile(original, file.mtimeMs);
    if (!preParsed.ok) {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "invalid_task",
        message: `Existing task file is malformed: ${preParsed.reason}`,
      };
    }
    if (preParsed.task.status !== "pending") {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "not_pending",
        message: `Cannot edit task ${input.id}: only pending tasks can be edited (current status: ${preParsed.task.status})`,
        next_action_hint:
          "Use complete_task / fail_task / wait_task for terminal status changes.",
      };
    }

    const updated = applyLinePatches(original, input.patches);
    const parsed = parseTaskFile(updated, file.mtimeMs);
    if (!parsed.ok) {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "invalid_task",
        message: `Patched content failed validation: ${parsed.reason}`,
        next_action_hint:
          "Check that frontmatter YAML stays valid and required fields (id, name, status, priority, etc.) are preserved.",
      };
    }
    if (parsed.task.id !== input.id) {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "id_mismatch",
        message: `frontmatter id '${parsed.task.id}' does not match the task id '${input.id}'`,
        next_action_hint:
          "Don't change the id frontmatter field; create a new task with create_task if you need a different id.",
      };
    }
    if (parsed.task.status !== "pending") {
      return {
        id: input.id,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "status_change_forbidden",
        message: `Patch would change task status from 'pending' to '${parsed.task.status}'. Status transitions must go through complete_task / fail_task / wait_task so the terminal-tool loop and summary are recorded.`,
        next_action_hint:
          "Don't edit the status frontmatter field; use complete_task, fail_task, or wait_task to transition state.",
      };
    }
    // Worker-managed fields: claim state is set by claimNextTask /
    // releaseTaskLock, output by complete_task, waiting_reason by wait_task.
    // A pending task should have all four null; refuse any patch that
    // changes them so the agent can't backdoor a claim or fake an output.
    const workerManaged: Array<keyof typeof parsed.task> = [
      "claimed_by",
      "claimed_at",
      "output",
      "waiting_reason",
    ];
    for (const field of workerManaged) {
      if (parsed.task[field] !== preParsed.task[field]) {
        return {
          id: input.id,
          path: filePath,
          applied: 0,
          content: original,
          is_error: true,
          error_type: "worker_field_change_forbidden",
          message: `Patch would change worker-managed field '${field}'. Only complete_task / fail_task / wait_task / the claim loop may set claimed_by, claimed_at, output, and waiting_reason.`,
          next_action_hint: `Don't edit the ${field} frontmatter field.`,
        };
      }
    }

    try {
      await validateBlockedBy(ctx.projectDir, input.id, parsed.task.blocked_by);
    } catch (err) {
      if (err instanceof CircularDependencyError) {
        return {
          id: input.id,
          path: filePath,
          applied: 0,
          content: original,
          is_error: true,
          error_type: "circular_dependency",
          message: err.message,
          next_action_hint:
            "Pick blockers that don't transitively depend on this task.",
        };
      }
      throw err;
    }

    const fm: TaskFrontmatter = {
      id: parsed.task.id,
      name: parsed.task.name,
      description: parsed.task.description,
      priority: parsed.task.priority,
      status: parsed.task.status,
      blocked_by: parsed.task.blocked_by,
      context_paths: parsed.task.context_paths,
      output: parsed.task.output,
      waiting_reason: parsed.task.waiting_reason,
      claimed_by: parsed.task.claimed_by,
      claimed_at: parsed.task.claimed_at,
      created_at: parsed.task.created_at,
      updated_at: new Date().toISOString(),
    };
    const serialized = serializeTask(fm, parsed.task.body);

    try {
      await atomicWriteIfUnchanged(filePath, serialized, file.mtimeMs);
    } catch (err) {
      if (err instanceof MtimeConflictError) {
        return {
          id: input.id,
          path: filePath,
          applied: 0,
          content: original,
          is_error: true,
          error_type: "mtime_conflict",
          message: `Task was modified concurrently: ${err.message}`,
          next_action_hint:
            "Re-read the task with view_task and recompute your patch line numbers before retrying.",
        };
      }
      throw err;
    }

    return {
      id: input.id,
      path: filePath,
      applied: input.patches.length,
      content: serialized,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
