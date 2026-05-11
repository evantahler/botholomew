import { isHelpfulError } from "membot";
import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  logical_path: z.string().describe("Logical path of the file to count."),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  logical_path: z.string().optional(),
  line_count: z.number().optional(),
  size_bytes: z.number().nullable().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const membotCountLinesTool = {
  name: "membot_count_lines",
  description:
    "[[ bash equivalent command: wc -l ]] Count lines in a stored file's markdown surrogate. Useful before a large membot_read or membot_edit to decide whether to fetch the whole body or page through it with `offset`/`limit`.",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const result = await ctx.mem.read({ logical_path: input.logical_path });
      const content = result.content ?? "";
      const lineCount = content === "" ? 0 : content.split("\n").length;
      return {
        is_error: false,
        logical_path: result.logical_path,
        line_count: lineCount,
        size_bytes: result.size_bytes,
      };
    } catch (err) {
      if (isHelpfulError(err)) {
        return {
          is_error: true,
          error_type: err.kind,
          message: err.message,
          next_action_hint: err.hint,
        };
      }
      return {
        is_error: true,
        error_type: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
