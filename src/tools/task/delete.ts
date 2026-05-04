import { z } from "zod";
import { deleteTask, getTask } from "../../tasks/store.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  id: z.string().describe("ID of the task to delete"),
});

const outputSchema = z.object({
  deleted_id: z.string().nullable(),
  message: z.string(),
  is_error: z.boolean(),
});

export const deleteTaskTool = {
  name: "delete_task",
  description:
    "[[ bash equivalent command: rm ]] Delete a task permanently. Refuses in_progress tasks; wait for the worker to finish or run `botholomew task reset <id>` first.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const existing = await getTask(ctx.projectDir, input.id);
    if (!existing) {
      return {
        deleted_id: null,
        message: `Task ${input.id} not found`,
        is_error: true,
      };
    }
    if (existing.status === "in_progress") {
      return {
        deleted_id: null,
        message: `Cannot delete task ${input.id}: it is currently in_progress (claimed by ${existing.claimed_by ?? "unknown"}). Wait for the worker to finish, or reset it first via \`botholomew task reset ${input.id}\`.`,
        is_error: true,
      };
    }
    const ok = await deleteTask(ctx.projectDir, input.id);
    if (!ok) {
      return {
        deleted_id: null,
        message: `Failed to delete task ${input.id}`,
        is_error: true,
      };
    }
    logger.info(`Deleted task: ${existing.name} (${existing.id})`);
    return {
      deleted_id: existing.id,
      message: `Deleted task "${existing.name}" (${existing.id})`,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
