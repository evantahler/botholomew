import { z } from "zod";
import {
  dirSizeBytes,
  NotDirectoryError,
  NotFoundError,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .default("")
    .describe("Directory path under context/ (defaults to context root)"),
});

const outputSchema = z.object({
  files: z.number(),
  bytes: z.number(),
  formatted: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const contextDirSizeTool = {
  name: "context_dir_size",
  description:
    "[[ bash equivalent command: du -s ]] Get the total size of files under a directory in context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const { files, bytes } = await dirSizeBytes(
        ctx.projectDir,
        input.path ?? "",
      );
      return {
        files,
        bytes,
        formatted: formatBytes(bytes),
        is_error: false,
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          files: 0,
          bytes: 0,
          formatted: formatBytes(0),
          is_error: true,
          error_type: "not_found",
          message: `No directory at context/${err.path}`,
        };
      }
      if (err instanceof NotDirectoryError) {
        return {
          files: 0,
          bytes: 0,
          formatted: formatBytes(0),
          is_error: true,
          error_type: "not_a_directory",
          message: `context/${err.path} is not a directory`,
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
