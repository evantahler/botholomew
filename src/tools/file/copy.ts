import { z } from "zod";
import { contextPathExists, copyContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  src: z.string().describe("Source file path"),
  dst: z.string().describe("Destination file path"),
  overwrite: z.boolean().optional().describe("Overwrite if destination exists"),
});

const outputSchema = z.object({
  id: z.string(),
  path: z.string(),
});

export const fileCopyTool = {
  name: "file_copy",
  description: "Copy a file in the virtual filesystem.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!input.overwrite && (await contextPathExists(ctx.conn, input.dst))) {
      throw new Error(`Destination already exists: ${input.dst}`);
    }

    const item = await copyContextItem(ctx.conn, input.src, input.dst);
    return { id: item.id, path: item.context_path };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
