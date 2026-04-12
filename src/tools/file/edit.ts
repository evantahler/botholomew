import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import { applyPatchesToContextItem } from "../../db/context.ts";

const PatchSchema = z.object({
  start_line: z.number().describe("1-based inclusive start line"),
  end_line: z
    .number()
    .describe("1-based inclusive end line (0 to insert without replacing)"),
  content: z
    .string()
    .describe("Replacement text (empty string to delete lines)"),
});

export const fileEditTool: ToolDefinition<any, any> = {
  name: "file_edit",
  description:
    "Apply git-style patches to a file. Each patch specifies a line range to replace.",
  group: "file",
  inputSchema: z.object({
    path: z.string().describe("File path to edit"),
    patches: z.array(PatchSchema).describe("Patches to apply"),
  }),
  outputSchema: z.object({
    applied: z.number(),
    content: z.string(),
  }),
  execute: async (input, ctx) => {
    const { item, applied } = await applyPatchesToContextItem(
      ctx.conn,
      input.path,
      input.patches,
    );
    return { applied, content: item.content ?? "" };
  },
};
