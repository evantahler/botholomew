import { z } from "zod";
import { loadSkills } from "../../skills/loader.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z.string().describe("Skill name (case-insensitive)"),
});

const outputSchema = z.object({
  name: z.string().nullable(),
  path: z.string().nullable(),
  deleted: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const skillDeleteTool = {
  name: "skill_delete",
  description:
    "[[ bash equivalent command: rm ]] Delete a skill file (user-defined slash command) by name. The file is removed from .botholomew/skills/. Returns a not_found error with the list of available names when the skill doesn't exist.",
  group: "skill",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const skills = await loadSkills(ctx.projectDir);
    const skill = skills.get(input.name.toLowerCase());

    if (!skill) {
      const available = [...skills.keys()].sort();
      const hint =
        available.length > 0
          ? `Available: ${available.join(", ")}. Use skill_list to browse.`
          : "No skills exist yet. Use skill_write to create one.";
      return {
        name: input.name,
        path: null,
        deleted: false,
        is_error: true,
        error_type: "not_found",
        message: `Skill not found: ${input.name}`,
        next_action_hint: hint,
      };
    }

    await Bun.file(skill.filePath).delete();

    return {
      name: skill.name,
      path: skill.filePath,
      deleted: true,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
