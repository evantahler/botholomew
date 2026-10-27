import { z } from "zod";
import { getThread } from "../../threads/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("Thread ID to view"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe(
      "1-based sequence to start from (skip earlier interactions). Use with `limit` to paginate long threads.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe(
      "Max interactions to return in this page. Default 50 keeps long threads from blowing the LLM context window.",
    ),
});

const outputSchema = z.object({
  thread: z
    .object({
      id: z.string(),
      type: z.string(),
      task_id: z.string().nullable(),
      title: z.string(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
    })
    .nullable(),
  interactions: z.array(
    z.object({
      id: z.string(),
      sequence: z.number(),
      role: z.string(),
      kind: z.string(),
      content: z.string(),
      tool_name: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  total_interactions: z.number(),
  offset: z.number(),
  limit: z.number(),
  has_more: z.boolean(),
  is_error: z.boolean(),
  next_action_hint: z.string().optional(),
});

export const viewThreadTool = {
  name: "view_thread",
  description:
    "View a thread's metadata and a paginated slice of its interactions. Pass `offset` (sequence to start from) and `limit` to walk a long thread without flooding the context window. `search_threads` returns `(thread_id, sequence)` pairs you can plug into `offset` to jump straight to a hit.",
  group: "thread",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const result = await getThread(ctx.projectDir, input.id);
    if (!result) {
      return {
        thread: null,
        interactions: [],
        total_interactions: 0,
        offset: input.offset,
        limit: input.limit,
        has_more: false,
        is_error: false,
      };
    }
    const total = result.interactions.length;
    const start = Math.min(input.offset, total);
    const end = Math.min(start + input.limit, total);
    const page = result.interactions.slice(start, end);
    const hasMore = end < total;
    return {
      thread: {
        id: result.thread.id,
        type: result.thread.type,
        task_id: result.thread.task_id,
        title: result.thread.title,
        started_at: result.thread.started_at.toISOString(),
        ended_at: result.thread.ended_at?.toISOString() ?? null,
      },
      interactions: page.map((i) => ({
        id: i.id,
        sequence: i.sequence,
        role: i.role,
        kind: i.kind,
        content: i.content,
        tool_name: i.tool_name,
        created_at: i.created_at.toISOString(),
      })),
      total_interactions: total,
      offset: start,
      limit: input.limit,
      has_more: hasMore,
      next_action_hint: hasMore
        ? `Call view_thread again with offset=${end} to see the next page.`
        : undefined,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
