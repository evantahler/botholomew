import { z } from "zod";
import { contextPathExists } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

export const fileExistsTool: ToolDefinition<any, any> = {
  name: "file_exists",
  description: "Check if a file exists in the virtual filesystem.",
  group: "file",
  inputSchema: z.object({
    path: z.string().describe("File path to check"),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
  }),
  execute: async (input, ctx) => {
    const exists = await contextPathExists(ctx.conn, input.path);
    return { exists };
  },
};
