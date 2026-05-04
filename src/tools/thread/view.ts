import { z } from "zod";
import { getThread } from "../../threads/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("Thread ID to view"),
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
  is_error: z.boolean(),
});

export const viewThreadTool = {
  name: "view_thread",
  description:
    "View a thread and its full interaction log (messages, tool calls, results).",
  group: "thread",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const result = await getThread(ctx.projectDir, input.id);
    if (!result) return { thread: null, interactions: [], is_error: false };
    return {
      thread: {
        id: result.thread.id,
        type: result.thread.type,
        task_id: result.thread.task_id,
        title: result.thread.title,
        started_at: result.thread.started_at.toISOString(),
        ended_at: result.thread.ended_at?.toISOString() ?? null,
      },
      interactions: result.interactions.map((i) => ({
        id: i.id,
        sequence: i.sequence,
        role: i.role,
        kind: i.kind,
        content: i.content,
        tool_name: i.tool_name,
        created_at: i.created_at.toISOString(),
      })),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
