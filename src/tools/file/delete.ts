import { z } from "zod";
import {
  deleteContextItemByPath,
  deleteContextItemsByPrefix,
} from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Path to delete"),
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
  description: "Delete a context item or directory.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (input.recursive) {
      const count = await deleteContextItemsByPrefix(ctx.conn, input.path);
      const exact = await deleteContextItemByPath(ctx.conn, input.path);
      return { deleted: count + (exact ? 1 : 0), is_error: false };
    }

    const deleted = await deleteContextItemByPath(ctx.conn, input.path);
    if (!deleted && !input.force) {
      throw new Error(`Not found: ${input.path}`);
    }
    return { deleted: deleted ? 1 : 0, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
