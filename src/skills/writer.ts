import matter from "gray-matter";
import { BUILTIN_SLASH_COMMANDS } from "./commands.ts";
import type { SkillArgDef } from "./parser.ts";

export const RESERVED_SKILL_NAMES = new Set(
  BUILTIN_SLASH_COMMANDS.map((c) => c.name),
);

const MAX_NAME_LENGTH = 64;

export type ValidateNameResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: "empty" | "invalid" | "reserved" | "too_long" };

export function validateSkillName(raw: string): ValidateNameResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "empty" };
  }

  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized === "") return { ok: false, reason: "invalid" };
  if (normalized.length > MAX_NAME_LENGTH)
    return { ok: false, reason: "too_long" };
  if (RESERVED_SKILL_NAMES.has(normalized))
    return { ok: false, reason: "reserved" };

  return { ok: true, normalized };
}

export interface SkillFileInput {
  name: string;
  description: string;
  arguments: SkillArgDef[];
  body: string;
}

export function buildSkillFileContent(input: SkillFileInput): string {
  const data: Record<string, unknown> = {
    name: input.name,
    description: input.description,
  };

  if (input.arguments.length > 0) {
    data.arguments = input.arguments.map((a) => {
      const out: Record<string, unknown> = {
        name: a.name,
        description: a.description,
        required: a.required,
      };
      if (a.default !== undefined) out.default = a.default;
      return out;
    });
  } else {
    data.arguments = [];
  }

  return matter.stringify(input.body, data);
}
