import { z } from "zod";
import {
  IsDirectoryError,
  NotFoundError,
  readContextFile,
} from "../../context/store.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  path: z.string().describe("Path under context/"),
});

const outputSchema = z.object({
  lines: z.number(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
});

export const contextCountLinesTool = {
  name: "context_count_lines",
  description:
    "[[ bash equivalent command: wc -l ]] Count the number of lines in a text file under context/.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const content = await readContextFile(ctx.projectDir, input.path);
      return {
        lines: content === "" ? 0 : content.split("\n").length,
        is_error: false,
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          lines: 0,
          is_error: true,
          error_type: "not_found",
          message: `No file at context/${err.path}`,
        };
      }
      if (err instanceof IsDirectoryError) {
        return {
          lines: 0,
          is_error: true,
          error_type: "is_directory",
          message: `context/${err.path} is a directory`,
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
