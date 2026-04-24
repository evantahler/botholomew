import { z } from "zod";
import { formatDriveRef } from "../../context/drives.ts";
import { resolveContextItemOrThrow } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  drive: z.string().describe("Drive name (e.g. 'disk', 'agent')"),
  path: z.string().describe("Path within the drive"),
});

const outputSchema = z.object({
  lines: z.number(),
  is_error: z.boolean(),
});

export const contextCountLinesTool = {
  name: "context_count_lines",
  description:
    "[[ bash equivalent command: wc -l ]] Count the number of lines in a text context item.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const ref = formatDriveRef({ drive: input.drive, path: input.path });
    const item = await resolveContextItemOrThrow(ctx.conn, ref);
    if (item.content == null) throw new Error(`No text content: ${ref}`);

    return { lines: item.content.split("\n").length, is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
