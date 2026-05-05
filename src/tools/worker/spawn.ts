import { z } from "zod";
import { spawnWorker } from "../../worker/spawn.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  task_id: z
    .string()
    .optional()
    .describe(
      "Specific task ID to run. If omitted, the worker claims the next eligible task from the queue.",
    ),
  persist: z
    .boolean()
    .optional()
    .describe(
      "If true, spawn a long-running worker that loops over the tick cycle. Defaults to false (one-shot).",
    ),
});

const outputSchema = z.object({
  worker_pid: z.number().nullable(),
  mode: z.enum(["once", "persist"]),
  message: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const spawnWorkerTool = {
  name: "spawn_worker",
  description:
    "Spawn a background worker to run a task without blocking this chat. One-shot by default (claims one task and exits). Use for work the user wants executed now rather than simply queued.",
  group: "worker",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const mode = input.persist ? "persist" : "once";
    try {
      const { pid } = await spawnWorker(ctx.projectDir, {
        mode,
        taskId: input.task_id,
      });
      const target = input.task_id
        ? `task ${input.task_id}`
        : "next eligible task";
      return {
        worker_pid: pid,
        mode,
        message: `Spawned ${mode} worker (pid ${pid}) for ${target}.`,
        is_error: false,
      };
    } catch (err) {
      return {
        worker_pid: null,
        mode,
        message: err instanceof Error ? err.message : String(err),
        is_error: true,
        error_type: "spawn_failed",
        next_action_hint:
          "Bun must be on PATH for the spawned child to launch. Confirm with `which bun` from the same shell that runs the agent.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
