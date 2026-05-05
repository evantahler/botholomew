import { z } from "zod";
import { listThreads } from "../../threads/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  type: z
    .enum(["worker_tick", "chat_session"])
    .optional()
    .describe("Filter by thread type"),
  limit: z.number().optional().describe("Max number of threads to return"),
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
  is_error: z.boolean(),
});

export const listThreadsTool = {
  name: "list_threads",
  description: "List conversation threads (worker ticks or chat sessions).",
  group: "thread",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const threads = await listThreads(ctx.projectDir, {
      type: input.type,
      limit: input.limit,
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
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
