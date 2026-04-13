import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

export const waitTaskTool: ToolDefinition<any, any> = {
  name: "wait_task",
  description:
    "Put the task in waiting status (e.g., needs human input, rate limited).",
  group: "task",
  terminal: true,
  inputSchema: z.object({
    reason: z.string().describe("Why the task is waiting"),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  execute: async (input) => ({
    message: `Task waiting: ${input.reason}`,
  }),
};
