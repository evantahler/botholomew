import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import {
  deleteContextItemByPath,
  deleteContextItemsByPrefix,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z.string().describe("Drive name"),
  path: z.string().describe("Path to delete within the drive"),
  recursive: z
    .boolean()
    .optional()
    .describe("Delete all items under this path prefix"),
  force: z
    .boolean()
    .optional()
    .describe("Do not error if the path does not exist"),
});

const outputSchema = z.object({
  deleted: z.number(),
  is_error: z.boolean(),
});

export const contextDeleteTool = {
  name: "context_delete",
  description:
    "[[ bash equivalent command: rm -r ]] Delete a context item or directory.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const target = { drive: input.drive, path: input.path };
    if (input.recursive) {
      const count = await deleteContextItemsByPrefix(
        ctx.conn,
        target.drive,
        target.path,
      );
      const exact = await deleteContextItemByPath(ctx.conn, target);
      return { deleted: count + (exact ? 1 : 0), is_error: false };
    }

    const deleted = await deleteContextItemByPath(ctx.conn, target);
    if (!deleted && !input.force) {
      throw new Error(`Not found: ${formatDriveRef(target)}`);
    }
    return { deleted: deleted ? 1 : 0, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
