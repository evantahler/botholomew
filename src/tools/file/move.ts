import { z } from "zod";
import { contextPathExists, moveContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  src: z.string().describe("Source file path"),
  dst: z.string().describe("Destination file path"),
  overwrite: z.boolean().optional().describe("Overwrite if destination exists"),
});

const outputSchema = z.object({
  path: z.string(),
});

export const fileMoveTool = {
  name: "file_move",
  description: "Move or rename a file in the virtual filesystem.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!input.overwrite && (await contextPathExists(ctx.conn, input.dst))) {
      throw new Error(`Destination already exists: ${input.dst}`);
    }

    await moveContextItem(ctx.conn, input.src, input.dst);
    return { path: input.dst };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
