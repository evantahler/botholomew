import { join } from "node:path";
import { z } from "zod";
import { getSkillsDir } from "../../constants.ts";
import { parseSkillFile } from "../../skills/parser.ts";
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
  name: z.string().describe("Skill name (case-insensitive)"),
  patches: z.array(PatchSchema).describe("Patches to apply"),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  applied: z.number(),
  content: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

function applyPatches(
  raw: string,
  patches: Array<{ start_line: number; end_line: number; content: string }>,
): string {
  const lines = raw.split("\n");
  const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

  for (const patch of sorted) {
    if (patch.end_line === 0) {
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, 0, ...insertLines);
    } else {
      const deleteCount = patch.end_line - patch.start_line + 1;
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, deleteCount, ...insertLines);
    }
  }

  return lines.join("\n");
}

export const skillEditTool = {
  name: "skill_edit",
  description:
    "[[ bash equivalent command: patch ]] Apply git-style line-range patches to a skill file (user-defined slash command). Operates on the whole file (frontmatter + body). Patches whose result would not parse as a valid skill are rejected without writing. Use skill_read first to inspect current line numbers.",
  group: "skill",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const normalized = input.name.toLowerCase();
    const filePath = join(getSkillsDir(ctx.projectDir), `${normalized}.md`);

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return {
        name: normalized,
        path: null,
        applied: 0,
        content: "",
        is_error: true,
        error_type: "not_found",
        message: `Skill not found: ${input.name}`,
        next_action_hint:
          "Use skill_list to see available skills, or skill_write to create one.",
      };
    }

    const original = await file.text();
    const updated = applyPatches(original, input.patches);

    try {
      const parsed = parseSkillFile(updated, filePath);
      if (parsed.name !== normalized) {
        throw new Error(
          `frontmatter name '${parsed.name}' no longer matches filename '${normalized}'`,
        );
      }
    } catch (err) {
      return {
        name: normalized,
        path: filePath,
        applied: 0,
        content: original,
        is_error: true,
        error_type: "invalid_skill",
        message: `Patched content failed validation: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "Check that frontmatter YAML stays valid and the file still has a name/description.",
      };
    }

    await Bun.write(filePath, updated);

    return {
      name: normalized,
      path: filePath,
      applied: input.patches.length,
      content: updated,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
