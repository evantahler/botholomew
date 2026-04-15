import { z } from "zod";
import { getTask } from "../../db/tasks.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("Task ID to view"),
});

const outputSchema = z.object({
  task: z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      status: z.string(),
      priority: z.string(),
      waiting_reason: z.string().nullable(),
      claimed_by: z.string().nullable(),
      blocked_by: z.array(z.string()),
      context_ids: z.array(z.string()),
      created_at: z.string(),
      updated_at: z.string(),
    })
    .nullable(),
  is_error: z.boolean(),
});

export const viewTaskTool = {
  name: "view_task",
  description: "View full details of a task by ID.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const task = await getTask(ctx.conn, input.id);
    if (!task) return { task: null, is_error: true };
    return {
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        status: task.status,
        priority: task.priority,
        waiting_reason: task.waiting_reason,
        claimed_by: task.claimed_by,
        blocked_by: task.blocked_by,
        context_ids: task.context_ids,
        created_at: task.created_at.toISOString(),
        updated_at: task.updated_at.toISOString(),
      },
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
