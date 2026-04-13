import { z } from "zod";
import { createSchedule } from "../../db/schedules.ts";
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
});

const outputSchema = z.object({
  id: z.string(),
  name: z.string(),
  message: z.string(),
});

export const createScheduleTool = {
  name: "create_schedule",
  description:
    "Create a new recurring schedule that will automatically generate tasks.",
  group: "schedule",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const schedule = await createSchedule(ctx.conn, {
      name: input.name,
      description: input.description,
      frequency: input.frequency,
    });
    logger.info(`Created schedule: ${schedule.name} (${schedule.id})`);
    return {
      id: schedule.id,
      name: schedule.name,
      message: `Created schedule "${schedule.name}" with frequency "${schedule.frequency}"`,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
