import { z } from "zod";
import { createTask, TASK_PRIORITIES } from "../../db/tasks.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z.string().describe("Task name"),
  description: z.string().optional().describe("Task description"),
  priority: z.enum(TASK_PRIORITIES).optional().describe("Task priority"),
  blocked_by: z
    .array(z.string())
    .optional()
    .describe("IDs of tasks that must complete first"),
});

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  message: z.string(),
});

export const createTaskTool = {
  name: "create_task",
  description: "Create a new task to be worked on later.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const newTask = await createTask(ctx.conn, {
      name: input.name,
      description: input.description,
      priority: input.priority,
      blocked_by: input.blocked_by,
    });
    logger.info(`Created subtask: ${newTask.name} (${newTask.id})`);
    return {
      id: newTask.id,
      name: newTask.name,
      message: `Created task "${newTask.name}" with ID ${newTask.id}`,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
