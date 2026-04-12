import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

export const completeTaskTool: ToolDefinition<any, any> = {
  name: "complete_task",
  description:
    "Mark the current task as complete with a summary of what was accomplished.",
  group: "task",
  terminal: true,
  inputSchema: z.object({
    summary: z.string().describe("Summary of work done"),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  execute: async (input) => ({
    message: `Task completed: ${input.summary}`,
  }),
};
