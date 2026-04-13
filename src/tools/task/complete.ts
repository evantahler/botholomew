import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  summary: z.string().describe("Summary of work done"),
});

const outputSchema = z.object({
  message: z.string(),
});

export const completeTaskTool = {
  name: "complete_task",
  description:
    "Mark the current task as complete with a summary of what was accomplished.",
  group: "task",
  terminal: true,
  inputSchema,
  outputSchema,
  execute: async (input) => ({
    message: `Task completed: ${input.summary}`,
  }),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
