import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import {
  contextPathExists,
  deleteContextItemByPath,
  moveContextItem,
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
  ref: z.string(),
  is_error: z.boolean(),
});

export const contextMoveTool = {
  name: "context_move",
  description:
    "[[ bash equivalent command: mv ]] Move or rename a context item (can also relocate between drives).",
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

    await moveContextItem(ctx.conn, src, dst);

    return { ref: formatDriveRef(dst), is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
