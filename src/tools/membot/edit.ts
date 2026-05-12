import { isHelpfulError } from "membot";
import { z } from "zod";
import { applyLinePatches, LinePatchSchema } from "../../fs/patches.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  logical_path: z
    .string()
    .describe("Logical path of the file to edit (e.g. 'notes/foo.md')."),
  patches: z
    .array(LinePatchSchema)
    .min(1)
    .describe(
      "Git-hunk-style edits applied bottom-up. `end_line: 0` inserts; empty `content` deletes.",
    ),
  change_note: z
    .string()
    .optional()
    .describe("Free-text note attached to the new version."),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  logical_path: z.string().optional(),
  version_id: z.string().optional(),
  size_bytes: z.number().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const membotEditTool = {
  name: "membot_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply line-range edits to a stored file: reads the current version, applies bottom-up patches, and writes the result back as a new version. Prefer this over membot_write when you only need to change part of a file — the diff is small and the change_note travels with the new version. To replace the whole body, use membot_write. To delete the file, use membot_delete.",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    try {
      const current = await ctx.mem.read({ logical_path: input.logical_path });
      const next = applyLinePatches(current.content ?? "", input.patches);
      const result = await ctx.mem.write({
        logical_path: input.logical_path,
        content: next,
        change_note: input.change_note,
      });
      return {
        is_error: false,
        logical_path: result.logical_path,
        version_id: result.version_id,
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
        next_action_hint:
          "Re-read the file with membot_read to confirm current line numbers, then retry.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
