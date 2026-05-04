import { z } from "zod";
import {
  IsDirectoryError,
  NotFoundError,
  readContextFile,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z
    .string()
    .describe(
      "Project-relative path under context/ (e.g. 'notes/foo.md'). Forward-slashes; never absolute.",
    ),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Maximum number of lines to return"),
});

const outputSchema = z.object({
  content: z.string().optional(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const contextReadTool = {
  name: "context_read",
  description: "[[ bash equivalent command: cat ]] Read a file under context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      let content = await readContextFile(ctx.projectDir, input.path);
      if (input.offset || input.limit) {
        const lines = content.split("\n");
        const start = (input.offset ?? 1) - 1;
        const end = input.limit ? start + input.limit : lines.length;
        content = lines.slice(start, end).join("\n");
      }
      return { content, is_error: false };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          is_error: true,
          error_type: "not_found",
          message: `No file at context/${err.path}`,
          next_action_hint:
            "Call context_tree to browse, or context_exists to check first.",
        };
      }
      if (err instanceof IsDirectoryError) {
        return {
          is_error: true,
          error_type: "is_directory",
          message: `context/${err.path} is a directory`,
          next_action_hint: "Use context_tree to list its contents.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
