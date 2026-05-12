import { isHelpfulError } from "membot";
import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  from_logical_path: z.string().describe("Source path"),
  to_logical_path: z.string().describe("Destination path"),
  change_note: z.string().optional(),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  from_logical_path: z.string().optional(),
  to_logical_path: z.string().optional(),
  new_version_id: z.string().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const membotCopyTool = {
  name: "membot_copy",
  description:
    "[[ bash equivalent command: cp ]] Duplicate a file's current content under a new logical_path. The source is left untouched; the destination becomes a new inline-source version. Use membot_move to rename instead (the source is tombstoned in that case).",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const src = await ctx.mem.read({ logical_path: input.from_logical_path });
      const written = await ctx.mem.write({
        logical_path: input.to_logical_path,
        content: src.content ?? "",
        change_note:
          input.change_note ?? `copied from ${input.from_logical_path}`,
      });
      return {
        is_error: false,
        from_logical_path: input.from_logical_path,
        to_logical_path: written.logical_path,
        new_version_id: written.version_id,
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
