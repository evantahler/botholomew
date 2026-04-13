import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  reason: z.string().describe("Why the task failed"),
});

const outputSchema = z.object({
  message: z.string(),
});

export const failTaskTool = {
  name: "fail_task",
  description: "Mark the current task as failed with a reason.",
  group: "task",
  terminal: true,
  inputSchema,
  outputSchema,
  execute: async (input) => ({
    message: `Task failed: ${input.reason}`,
  }),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
