import { z } from "zod";
import { parseDriveRef } from "../../context/drives.ts";
import { getContextItem, getContextItemById } from "../../db/context.ts";
import { isUuid } from "../../db/uuid.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z
    .string()
    .describe("Drive name. Ignored when `path` is a UUID or 'drive:/path'."),
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
    const target = parsed ?? { drive: input.drive, path: input.path };
    const item = await getContextItem(ctx.conn, target);
    return { exists: item !== null, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
