import { z } from "zod";
import { ingestByPath } from "../../context/ingest.ts";
import { applyPatchesToContextItem } from "../../db/context.ts";
import type { ToolDefinition } from "../tool.ts";

const PatchSchema = z.object({
  start_line: z.number().describe("1-based inclusive start line"),
  end_line: z
    .number()
    .describe("1-based inclusive end line (0 to insert without replacing)"),
  content: z
    .string()
    .describe("Replacement text (empty string to delete lines)"),
});

const inputSchema = z.object({
  path: z.string().describe("File path to edit"),
  patches: z.array(PatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  applied: z.number(),
  content: z.string(),
});

export const fileEditTool = {
  name: "file_edit",
  description:
    "Apply git-style patches to a file. Each patch specifies a line range to replace.",
  group: "file",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const { item, applied } = await applyPatchesToContextItem(
      ctx.conn,
      input.path,
      input.patches,
    );

    await ingestByPath(ctx.conn, input.path, ctx.config);
    return { applied, content: item.content ?? "" };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
