import { z } from "zod";
import { getInfo, readContextFile } from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Path under context/"),
});

const fileSchema = z.object({
  path: z.string(),
  is_directory: z.boolean(),
  is_textual: z.boolean(),
  mime_type: z.string(),
  size: z.number(),
  lines: z.number(),
  mtime: z.string(),
  content_hash: z.string().nullable(),
});

const outputSchema = z.object({
  file: fileSchema.optional(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextInfoTool = {
  name: "context_info",
  description:
    "[[ bash equivalent command: stat ]] Show metadata for a path under context/: size, MIME type, line count, mtime, content hash.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const info = await getInfo(ctx.projectDir, input.path);
    if (!info) {
      return {
        is_error: true,
        error_type: "not_found",
        message: `No path at context/${input.path}`,
        next_action_hint: "Call context_tree to browse.",
      };
    }
    let lines = 0;
    if (info.is_textual && !info.is_directory) {
      const content = await readContextFile(ctx.projectDir, input.path);
      lines = content === "" ? 0 : content.split("\n").length;
    }
    return {
      file: {
        path: info.path,
        is_directory: info.is_directory,
        is_textual: info.is_textual,
        mime_type: info.mime_type,
        size: info.size,
        lines,
        mtime: info.mtime.toISOString(),
        content_hash: info.content_hash,
      },
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
