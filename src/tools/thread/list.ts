import { z } from "zod";
import { listThreads } from "../../threads/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  type: z
    .enum(["worker_tick", "chat_session"])
    .optional()
    .describe("Filter by thread type"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe(
      "Max number of threads to return (newest first). Default 50 keeps long histories from flooding the context window.",
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe("Skip the first N threads; use with `limit` to paginate."),
});

const outputSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      task_id: z.string().nullable(),
      title: z.string(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
    }),
  ),
  count: z.number(),
  offset: z.number(),
  is_error: z.boolean(),
  next_action_hint: z.string().optional(),
});

export const listThreadsTool = {
  name: "list_threads",
  description:
    "[[ bash equivalent command: ls ]] List conversation threads (worker ticks or chat sessions), newest first. Pass `offset` with `limit` to page through a long history.",
  group: "thread",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const threads = await listThreads(ctx.projectDir, {
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      threads: threads.map((t) => ({
        id: t.id,
        type: t.type,
        task_id: t.task_id,
        title: t.title,
        started_at: t.started_at.toISOString(),
        ended_at: t.ended_at?.toISOString() ?? null,
      })),
      count: threads.length,
      offset: input.offset,
      is_error: false,
      // The store returns only the sliced page (no total), so use the
      // full-page heuristic: a full page means there are possibly more.
      next_action_hint:
        threads.length === input.limit
          ? `Returned a full page; there may be more — call list_threads again with offset=${input.offset + input.limit} to see older threads.`
          : undefined,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
