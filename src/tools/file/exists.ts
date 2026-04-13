import { z } from "zod";
import { contextPathExists } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("File path to check"),
});

const outputSchema = z.object({
  exists: z.boolean(),
});

export const fileExistsTool = {
  name: "file_exists",
  description: "Check if a file exists in the virtual filesystem.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const exists = await contextPathExists(ctx.conn, input.path);
    return { exists };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
