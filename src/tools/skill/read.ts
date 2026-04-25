import { z } from "zod";
import { loadSkills } from "../../skills/loader.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  name: z.string().describe("Skill name (case-insensitive)"),
});

const ArgSchema = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean(),
  default: z.string().optional(),
});

const outputSchema = z.object({
  name: z.string(),
  path: z.string().nullable(),
  raw: z.string().nullable(),
  description: z.string(),
  arguments: z.array(ArgSchema),
  body: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const skillReadTool = {
  name: "skill_read",
  description:
    "[[ bash equivalent command: cat ]] Read a skill file (user-defined slash command) by name. Returns the raw file contents plus parsed fields. Returns a not_found error with the list of available names when the skill doesn't exist.",
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
        raw: null,
        description: "",
        arguments: [],
        body: "",
        is_error: true,
        error_type: "not_found",
        message: `Skill not found: ${input.name}`,
        next_action_hint: hint,
      };
    }

    const raw = await Bun.file(skill.filePath).text();

    return {
      name: skill.name,
      path: skill.filePath,
      raw,
      description: skill.description,
      arguments: skill.arguments,
      body: skill.body,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
