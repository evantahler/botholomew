import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

export const failTaskTool: ToolDefinition<any, any> = {
  name: "fail_task",
  description: "Mark the current task as failed with a reason.",
  group: "task",
  terminal: true,
  inputSchema: z.object({
    reason: z.string().describe("Why the task failed"),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  execute: async (input) => ({
    message: `Task failed: ${input.reason}`,
  }),
};
