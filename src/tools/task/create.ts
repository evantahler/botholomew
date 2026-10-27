import { z } from "zod";
import { resolveModel } from "../../config/models.ts";
import { TASK_PRIORITIES } from "../../tasks/schema.ts";
import { CircularDependencyError, createTask } from "../../tasks/store.ts";
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
  context_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Project-relative paths under context/ that the task should reference",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Named model from the `models` block in config to run this task on. Omit to use the default. Call `capabilities_refresh` or read config if unsure which names exist.",
    ),
});

const outputSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  message: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const createTaskTool = {
  name: "create_task",
  description:
    "Create a new task. Include as much context as possible in the description so the agent picking it up can start immediately without redundant lookups.",
  group: "task",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.model) {
      try {
        resolveModel(ctx.config, input.model);
      } catch (err) {
        return {
          id: null,
          name: null,
          message: err instanceof Error ? err.message : String(err),
          is_error: true,
          error_type: "unknown_model",
          next_action_hint:
            "Retry with one of the listed model names, or omit `model` to use the default.",
        };
      }
    }
    try {
      const newTask = await createTask(ctx.projectDir, {
        name: input.name,
        description: input.description,
        priority: input.priority,
        blocked_by: input.blocked_by,
        context_paths: input.context_paths,
        model: input.model ?? null,
      });
      const msg = `Created subtask: ${newTask.name} (${newTask.id})`;
      if (ctx.notify) ctx.notify(msg);
      else logger.info(msg);
      return {
        id: newTask.id,
        name: newTask.name,
        message: `Created task "${newTask.name}" with ID ${newTask.id}`,
        is_error: false,
      };
    } catch (err) {
      if (err instanceof CircularDependencyError) {
        return {
          id: null,
          name: null,
          message: err.message,
          is_error: true,
          error_type: "circular_dependency",
          next_action_hint:
            "Pick blockers that don't transitively depend on this task. `list_tasks` + `view_task` show the existing dependency graph.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
