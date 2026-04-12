import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import {
  deleteContextItemByPath,
  deleteContextItemsByPrefix,
} from "../../db/context.ts";

export const fileDeleteTool: ToolDefinition<any, any> = {
  name: "file_delete",
  description: "Delete a file or directory from the virtual filesystem.",
  group: "file",
  inputSchema: z.object({
    path: z.string().describe("Path to delete"),
    recursive: z
      .boolean()
      .optional()
      .describe("Delete all items under this path prefix"),
    force: z
      .boolean()
      .optional()
      .describe("Do not error if the path does not exist"),
  }),
  outputSchema: z.object({
    deleted: z.number(),
  }),
  execute: async (input, ctx) => {
    if (input.recursive) {
      const count = await deleteContextItemsByPrefix(ctx.conn, input.path);
      const exact = await deleteContextItemByPath(ctx.conn, input.path);
      return { deleted: count + (exact ? 1 : 0) };
    }

    const deleted = await deleteContextItemByPath(ctx.conn, input.path);
    if (!deleted && !input.force) {
      throw new Error(`Not found: ${input.path}`);
    }
    return { deleted: deleted ? 1 : 0 };
  },
};
