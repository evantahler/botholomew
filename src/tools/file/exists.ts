import { z } from "zod";
import { parseDriveRef } from "../../context/drives.ts";
import { getContextItem, getContextItemById } from "../../db/context.ts";
import { isUuid } from "../../db/uuid.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z
    .string()
    .optional()
    .describe("Drive name. Optional when `path` is a UUID or 'drive:/path'."),
  path: z
    .string()
    .describe("Path within the drive (or UUID / drive:/path ref)"),
});

const outputSchema = z.object({
  exists: z.boolean(),
  is_error: z.boolean(),
});

export const contextExistsTool = {
  name: "context_exists",
  description:
    "[[ bash equivalent command: test -e ]] Check if a context item exists.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (isUuid(input.path)) {
      const item = await getContextItemById(ctx.conn, input.path);
      return { exists: item !== null, is_error: false };
    }
    const parsed = parseDriveRef(input.path);
    if (parsed) {
      const item = await getContextItem(ctx.conn, parsed);
      return { exists: item !== null, is_error: false };
    }
    if (!input.drive) return { exists: false, is_error: false };
    const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
    const item = await getContextItem(ctx.conn, {
      drive: input.drive,
      path,
    });
    return { exists: item !== null, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
