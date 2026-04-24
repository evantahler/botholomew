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
  drive: z.string().describe("Drive name (e.g. 'agent', 'disk')"),
  path: z.string().describe("Path within the drive (starts with /)"),
  patches: z.array(PatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
});

export const contextEditTool = {
  name: "context_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply git-style patches to a context item. Each patch specifies a line range to replace.",
  group: "context",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const target = { drive: input.drive, path: input.path };
    const { item, applied } = await applyPatchesToContextItem(
      ctx.conn,
      target,
      input.patches,
    );

    await ingestByPath(ctx.conn, target, ctx.config);
    return { applied, content: item.content ?? "", is_error: false };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
