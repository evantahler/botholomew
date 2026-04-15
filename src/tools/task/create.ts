import { z } from "zod";
import { createTask, TASK_PRIORITIES } from "../../db/tasks.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z
    .string()
    .describe("Concise but descriptive task name summarizing the goal"),
  description: z
    .string()
    .optional()
    .describe(
      "Detailed description including relevant file paths, what needs to change, why, and any constraints. Rich descriptions reduce redundant tool calls when the task is picked up later.",
    ),
  priority: z
    .enum(TASK_PRIORITIES)
    .optional()
    .describe("Task priority (default: medium)"),
  blocked_by: z
    .array(z.string())
    .optional()
    .describe("IDs of tasks that must complete first"),
});

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  message: z.string(),
  is_error: z.boolean(),
});

export const createTaskTool = {
  name: "create_task",
  description:
    "Create a new task. Include as much context as possible in the description so the agent picking it up can start immediately without redundant lookups.",
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
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
