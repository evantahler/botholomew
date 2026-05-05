import { z } from "zod";
import { getTask } from "../../tasks/store.ts";
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
      output: z.string().nullable(),
      claimed_by: z.string().nullable(),
      blocked_by: z.array(z.string()),
      context_paths: z.array(z.string()),
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
    const task = await getTask(ctx.projectDir, input.id);
    if (!task) return { task: null, is_error: true };
    return {
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        status: task.status,
        priority: task.priority,
        waiting_reason: task.waiting_reason,
        output: task.output,
        claimed_by: task.claimed_by,
        blocked_by: task.blocked_by,
        context_paths: task.context_paths,
        created_at: task.created_at,
        updated_at: task.updated_at,
      },
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
