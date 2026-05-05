import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getSkillsDir } from "../../constants.ts";
import { parseSkillFile } from "../../skills/parser.ts";
import {
  buildSkillFileContent,
  validateSkillName,
} from "../../skills/writer.ts";
import type { ToolDefinition } from "../tool.ts";

const ArgInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Argument name (referenced as $1, $2, … in the body)"),
  description: z.string().optional().describe("Argument description"),
  required: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether the argument is required"),
  default: z
    .string()
    .optional()
    .describe("Default value when the argument is omitted"),
});

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "Skill name (slash-command identifier). Will be normalized to lowercase + [a-z0-9-]. Reserved: help, skills, clear, exit.",
    ),
  description: z
    .string()
    .describe("Short description shown in /skills and /help"),
  body: z
    .string()
    .describe(
      "Prompt-template body (markdown). Use $ARGUMENTS or $1..$9 for argument substitution.",
    ),
  arguments: z
    .array(ArgInputSchema)
    .optional()
    .describe("Argument definitions (positional)"),
  on_conflict: z
    .enum(["error", "overwrite"])
    .optional()
    .default("error")
    .describe(
      "What to do if a skill with this name already exists. Defaults to 'error'.",
    ),
});

const outputSchema = z.object({
  name: z.string().nullable(),
  path: z.string().nullable(),
  ref: z.string().nullable(),
  created: z.boolean(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const skillWriteTool = {
  name: "skill_write",
  description:
    "[[ bash equivalent command: tee ]] Create or overwrite a skill file (user-defined slash command) at skills/<name>.md. Fails with path_conflict when the file exists unless on_conflict='overwrite'. Reserved names (help, skills, clear, exit) are rejected. The generated file is parsed to validate before being written.",
  group: "skill",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const nameCheck = validateSkillName(input.name);
    if (!nameCheck.ok) {
      const errorType =
        nameCheck.reason === "reserved" ? "reserved_name" : "invalid_name";
      const message =
        nameCheck.reason === "reserved"
          ? `'${input.name}' is reserved by a built-in slash command (help, skills, clear, exit).`
          : nameCheck.reason === "too_long"
            ? `Skill name too long (max 64 chars after normalization).`
            : `'${input.name}' is not a valid skill name. After normalization (lowercase, [a-z0-9-], trimmed hyphens) it is empty.`;
      return {
        name: null,
        path: null,
        ref: null,
        created: false,
        is_error: true,
        error_type: errorType,
        message,
        next_action_hint:
          "Pick a different name made of lowercase letters, digits, and hyphens.",
      };
    }

    const normalized = nameCheck.normalized;
    const body = input.body.trim();
    if (body === "") {
      return {
        name: normalized,
        path: null,
        ref: null,
        created: false,
        is_error: true,
        error_type: "empty_body",
        message: "Skill body is empty.",
        next_action_hint:
          "Provide a non-empty prompt template using $ARGUMENTS or $1..$9.",
      };
    }

    const args = (input.arguments ?? []).map((a) => ({
      name: a.name,
      description: a.description ?? "",
      required: a.required ?? false,
      default: a.default,
    }));

    const skillsDir = getSkillsDir(ctx.projectDir);
    const filePath = join(skillsDir, `${normalized}.md`);

    const raw = buildSkillFileContent({
      name: normalized,
      description: input.description,
      arguments: args,
      body,
    });

    try {
      const parsed = parseSkillFile(raw, filePath);
      if (parsed.name !== normalized) {
        throw new Error(
          `frontmatter name '${parsed.name}' does not match expected '${normalized}'`,
        );
      }
    } catch (err) {
      return {
        name: normalized,
        path: null,
        ref: null,
        created: false,
        is_error: true,
        error_type: "invalid_skill",
        message: `Generated skill content failed validation: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "Check description and body for unusual characters that break YAML.",
      };
    }

    const onConflict = input.on_conflict ?? "error";
    const existed = await Bun.file(filePath).exists();

    if (existed && onConflict === "error") {
      return {
        name: normalized,
        path: filePath,
        ref: `skill:${normalized}`,
        created: false,
        is_error: true,
        error_type: "path_conflict",
        message: `Skill '${normalized}' already exists at ${filePath}.`,
        next_action_hint:
          "Retry with on_conflict='overwrite' to replace, or use skill_edit for a partial change.",
      };
    }

    await mkdir(skillsDir, { recursive: true });
    await Bun.write(filePath, raw);

    return {
      name: normalized,
      path: filePath,
      ref: `skill:${normalized}`,
      created: !existed,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
