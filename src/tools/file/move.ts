import { z } from "zod";
import { contextPathExists, moveContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

export const fileMoveTool: ToolDefinition<any, any> = {
  name: "file_move",
  description: "Move or rename a file in the virtual filesystem.",
  group: "file",
  inputSchema: z.object({
    src: z.string().describe("Source file path"),
    dst: z.string().describe("Destination file path"),
    overwrite: z
      .boolean()
      .optional()
      .describe("Overwrite if destination exists"),
  }),
  outputSchema: z.object({
    path: z.string(),
  }),
  execute: async (input, ctx) => {
    if (!input.overwrite && (await contextPathExists(ctx.conn, input.dst))) {
      throw new Error(`Destination already exists: ${input.dst}`);
    }

    await moveContextItem(ctx.conn, input.src, input.dst);
    return { path: input.dst };
  },
};
