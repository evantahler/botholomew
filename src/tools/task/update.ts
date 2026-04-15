import { z } from "zod";
import { getTask, TASK_PRIORITIES, updateTask } from "../../db/tasks.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("ID of the task to update"),
  name: z.string().optional().describe("Updated task name"),
  description: z.string().optional().describe("Updated task description"),
  priority: z.enum(TASK_PRIORITIES).optional().describe("Updated priority"),
  blocked_by: z
    .array(z.string())
    .optional()
    .describe("Replacement list of task IDs that must complete first"),
});

const outputSchema = z.object({
  task: z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      status: z.string(),
      priority: z.string(),
      blocked_by: z.array(z.string()),
      updated_at: z.string(),
    })
    .nullable(),
  message: z.string(),
  is_error: z.boolean(),
});

export const updateTaskTool = {
  name: "update_task",
  description:
    "Update a pending task's name, description, priority, or dependencies. Only pending tasks can be updated.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const existing = await getTask(ctx.conn, input.id);
    if (!existing) {
      return {
        task: null,
        message: `Task ${input.id} not found`,
        is_error: true,
      };
    }
    if (existing.status !== "pending") {
      return {
        task: null,
        message: `Cannot update task ${input.id}: only pending tasks can be updated (current status: ${existing.status})`,
        is_error: true,
      };
    }

    const updated = await updateTask(ctx.conn, input.id, {
      name: input.name,
      description: input.description,
      priority: input.priority,
      blocked_by: input.blocked_by,
    });

    if (!updated) {
      return {
        task: null,
        message: `Failed to update task ${input.id}`,
        is_error: true,
      };
    }

    logger.info(`Updated task: ${updated.name} (${updated.id})`);
    return {
      task: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        status: updated.status,
        priority: updated.priority,
        blocked_by: updated.blocked_by,
        updated_at: updated.updated_at.toISOString(),
      },
      message: `Updated task "${updated.name}"`,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
