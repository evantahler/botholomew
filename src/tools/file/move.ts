import { z } from "zod";
import {
  contextPathExists,
  deleteContextItemByPath,
  moveContextItem,
} from "../../db/context.ts";
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
    const dstExists = await contextPathExists(ctx.conn, input.dst);
    if (dstExists && !input.overwrite) {
      throw new Error(`Destination already exists: ${input.dst}`);
    }
    if (dstExists) {
      await deleteContextItemByPath(ctx.conn, input.dst);
    }

    await moveContextItem(ctx.conn, input.src, input.dst);

    // Update embedding source_paths to match new location
    ctx.conn
      .query("UPDATE embeddings SET source_path = ?1 WHERE source_path = ?2")
      .run(input.dst, input.src);

    return { path: input.dst };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
