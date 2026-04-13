import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  reason: z.string().describe("Why the task is waiting"),
});

const outputSchema = z.object({
  message: z.string(),
});

export const waitTaskTool = {
  name: "wait_task",
  description:
    "Put the task in waiting status (e.g., needs human input, rate limited).",
  group: "task",
  terminal: true,
  inputSchema,
  outputSchema,
  execute: async (input) => ({
    message: `Task waiting: ${input.reason}`,
  }),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
