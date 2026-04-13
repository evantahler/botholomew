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

export const dirSizeTool: ToolDefinition<any, any> = {
  name: "dir_size",
  description: "Get the total size of files in a directory.",
  group: "dir",
  inputSchema: z.object({
    path: z.string().optional().describe("Directory path (defaults to /)"),
    recursive: z
      .boolean()
      .optional()
      .describe("Include subdirectories (defaults to true)"),
  }),
  outputSchema: z.object({
    bytes: z.number(),
    formatted: z.string(),
  }),
  execute: async (input, ctx) => {
    const path = input.path ?? "/";
    const items = await listContextItemsByPrefix(ctx.conn, path, {
      recursive: input.recursive !== false,
    });

    let bytes = 0;
    for (const item of items) {
      if (item.content != null) bytes += item.content.length;
    }

    return { bytes, formatted: formatBytes(bytes) };
  },
};
