import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import {
  contextPathExists,
  copyContextItem,
  deleteContextItemByPath,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  src_drive: z.string().describe("Source drive"),
  src_path: z.string().describe("Source path within the drive"),
  dst_drive: z.string().describe("Destination drive"),
  dst_path: z.string().describe("Destination path within the drive"),
  overwrite: z.boolean().optional().describe("Overwrite if destination exists"),
});

const outputSchema = z.object({
  id: z.string(),
  ref: z.string(),
  is_error: z.boolean(),
});

export const contextCopyTool = {
  name: "context_copy",
  description: "[[ bash equivalent command: cp ]] Copy a context item.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const src = { drive: input.src_drive, path: input.src_path };
    const dst = { drive: input.dst_drive, path: input.dst_path };

    const dstExists = await contextPathExists(ctx.conn, dst);
    if (dstExists && !input.overwrite) {
      throw new Error(`Destination already exists: ${formatDriveRef(dst)}`);
    }
    if (dstExists) {
      await deleteContextItemByPath(ctx.conn, dst);
    }

    const item = await copyContextItem(ctx.conn, src, dst);
    return { id: item.id, ref: formatDriveRef(item), is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
