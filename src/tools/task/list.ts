import { z } from "zod";
import { listTasks, TASK_PRIORITIES, TASK_STATUSES } from "../../db/tasks.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  status: z.enum(TASK_STATUSES).optional().describe("Filter by status"),
  priority: z.enum(TASK_PRIORITIES).optional().describe("Filter by priority"),
  limit: z.number().optional().describe("Max number of tasks to return"),
});

const outputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      priority: z.string(),
      description: z.string(),
      created_at: z.string(),
    }),
  ),
  count: z.number(),
});

export const listTasksTool = {
  name: "list_tasks",
  description: "List tasks with optional status and priority filters.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const tasks = await listTasks(ctx.conn, {
      status: input.status,
      priority: input.priority,
      limit: input.limit,
    });
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        description: t.description,
        created_at: t.created_at.toISOString(),
      })),
      count: tasks.length,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
