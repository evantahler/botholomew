import { basename } from "node:path";
import matter from "gray-matter";

export interface SkillArgDef {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  arguments: SkillArgDef[];
  body: string;
  filePath: string;
}

export function parseSkillFile(raw: string, filePath: string): SkillDefinition {
  const { data, content } = matter(raw);

  const name: string =
    typeof data.name === "string" && data.name
      ? data.name.toLowerCase()
      : basename(filePath, ".md").toLowerCase();

  const description: string =
    typeof data.description === "string" ? data.description : "";

  const args: SkillArgDef[] = [];
  if (Array.isArray(data.arguments)) {
    for (const arg of data.arguments) {
      if (arg && typeof arg === "object" && typeof arg.name === "string") {
        args.push({
          name: arg.name,
          description:
            typeof arg.description === "string" ? arg.description : "",
          required: arg.required === true,
          default: typeof arg.default === "string" ? arg.default : undefined,
        });
      }
    }
  }

  return {
    name,
    description,
    arguments: args,
    body: content.trim(),
    filePath,
  };
}

/**
 * Split a raw argument string into positional tokens,
 * respecting double-quoted strings.
 */
function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;

  for (const ch of raw) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

export function renderSkill(skill: SkillDefinition, rawArgs: string): string {
  const tokens = tokenize(rawArgs);
  let result = skill.body;

  result = result.replaceAll("$ARGUMENTS", rawArgs);

  // Replace $1-$9 with positional args or defaults
  for (let i = 1; i <= 9; i++) {
    const token = tokens[i - 1];
    const argDef = skill.arguments[i - 1];
    const value = token ?? argDef?.default ?? "";
    result = result.replaceAll(`$${i}`, value);
  }

  return result;
}
