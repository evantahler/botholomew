import { z } from "zod";
import { listContextItemsByPrefix } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

const inputSchema = z.object({
  drive: z.string().describe("Drive name"),
  path: z.string().optional().describe("Directory path (defaults to /)"),
  recursive: z
    .boolean()
    .optional()
    .describe("Include subdirectories (defaults to true)"),
});

const outputSchema = z.object({
  bytes: z.number(),
  formatted: z.string(),
  is_error: z.boolean(),
});

export const contextDirSizeTool = {
  name: "context_dir_size",
  description:
    "[[ bash equivalent command: du -s ]] Get the total size of context items under a drive/directory.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const path = input.path ?? "/";
    const items = await listContextItemsByPrefix(ctx.conn, input.drive, path, {
      recursive: input.recursive !== false,
    });

    let bytes = 0;
    for (const item of items) {
      if (item.content != null) bytes += item.content.length;
    }

    return { bytes, formatted: formatBytes(bytes), is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
