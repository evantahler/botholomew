import { z } from "zod";
import { resolveModel } from "../../config/models.ts";
import { createSchedule } from "../../schedules/store.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z.string().describe("Schedule name"),
  description: z.string().optional().describe("What should happen on each run"),
  frequency: z
    .string()
    .describe(
      "How often to run, e.g. 'every morning', 'weekly on Mondays', 'every 2 hours'",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Named model from the `models` block in config that tasks spawned by this schedule inherit. Omit to use the default.",
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

export const createScheduleTool = {
  name: "create_schedule",
  description:
    "Create a new recurring schedule that will automatically generate tasks.",
  group: "schedule",
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
    const schedule = await createSchedule(ctx.projectDir, {
      name: input.name,
      description: input.description,
      frequency: input.frequency,
      model: input.model ?? null,
    });
    const msg = `Created schedule: ${schedule.name} (${schedule.id})`;
    if (ctx.notify) ctx.notify(msg);
    else logger.info(msg);
    return {
      id: schedule.id,
      name: schedule.name,
      message: `Created schedule "${schedule.name}" with frequency "${schedule.frequency}"`,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
