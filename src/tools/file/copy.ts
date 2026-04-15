import { z } from "zod";
import {
  contextPathExists,
  copyContextItem,
  deleteContextItemByPath,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  src: z.string().describe("Source file path"),
  dst: z.string().describe("Destination file path"),
  overwrite: z.boolean().optional().describe("Overwrite if destination exists"),
});

const outputSchema = z.object({
  id: z.string(),
  path: z.string(),
  is_error: z.boolean(),
});

export const fileCopyTool = {
  name: "file_copy",
  description: "Copy a file in the virtual filesystem.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const dstExists = await contextPathExists(ctx.conn, input.dst);
    if (dstExists && !input.overwrite) {
      throw new Error(`Destination already exists: ${input.dst}`);
    }
    if (dstExists) {
      await deleteContextItemByPath(ctx.conn, input.dst);
    }

    const item = await copyContextItem(ctx.conn, input.src, input.dst);
    return { id: item.id, path: item.context_path, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
