import { z } from "zod";
import { listSchedules } from "../../schedules/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  enabled: z.boolean().optional().describe("Filter by enabled status"),
  limit: z.number().optional().describe("Max number of schedules to return"),
  offset: z.number().optional().describe("Skip first N schedules"),
});

const outputSchema = z.object({
  schedules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      frequency: z.string(),
      enabled: z.boolean(),
      last_run_at: z.string().nullable(),
    }),
  ),
  count: z.number(),
  is_error: z.boolean(),
});

export const listSchedulesTool = {
  name: "list_schedules",
  description: "List existing recurring schedules.",
  group: "schedule",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const schedules = await listSchedules(ctx.projectDir, {
      enabled: input.enabled,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      schedules: schedules.map((s) => ({
        id: s.id,
        name: s.name,
        frequency: s.frequency,
        enabled: s.enabled,
        last_run_at: s.last_run_at,
      })),
      count: schedules.length,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
