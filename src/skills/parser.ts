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
 * Split a raw argument string into positional tokens, respecting both
 * single- and double-quoted strings. A closing quote must match the
 * opening quote; the other quote character is treated as a literal
 * inside the run.
 */
export function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | null = null;

  for (const ch of raw) {
    if (quoteChar === null && (ch === '"' || ch === "'")) {
      quoteChar = ch;
    } else if (quoteChar !== null && ch === quoteChar) {
      quoteChar = null;
    } else if (quoteChar === null && /\s/.test(ch)) {
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

/**
 * Schema-aware tokenizer used by skill rendering. When a skill declares
 * N >= 1 positional arguments, the first N - 1 tokens are split with
 * `tokenize()` and the **last** token captures the entire remaining
 * input verbatim (with surrounding whitespace trimmed and a single
 * surrounding pair of matched quotes stripped). This makes the common
 * case of an unquoted multi-word final argument "just work" — e.g.
 * `/write-as-evan why are avocados good?` for a single-arg skill puts
 * the whole sentence into `$1`.
 *
 * When N === 0 (no declared arguments), behaves exactly like
 * `tokenize()`.
 */
export function tokenizeForSkill(
  raw: string,
  skill: SkillDefinition,
): string[] {
  const n = skill.arguments.length;
  if (n === 0) return tokenize(raw);

  const tokens: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | null = null;
  let i = 0;

  for (; i < raw.length && tokens.length < n - 1; i++) {
    const ch = raw[i] as string;
    if (quoteChar === null && (ch === '"' || ch === "'")) {
      quoteChar = ch;
    } else if (quoteChar !== null && ch === quoteChar) {
      quoteChar = null;
    } else if (quoteChar === null && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  // Flush any in-progress token if we hit the N-1 cap mid-run.
  if (current) {
    tokens.push(current);
    current = "";
  }

  let remainder = raw.slice(i).trim();
  if (remainder.length >= 2) {
    const first = remainder[0];
    const last = remainder[remainder.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      // Strip surrounding quotes only when the entire remainder is a
      // single quoted string with no interior unescaped same-quote.
      const inner = remainder.slice(1, -1);
      if (!inner.includes(first)) remainder = inner;
    }
  }
  if (remainder.length > 0) tokens.push(remainder);

  return tokens;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderSkill(skill: SkillDefinition, rawArgs: string): string {
  const tokens = tokenizeForSkill(rawArgs, skill);
  let result = skill.body;

  // Replace $<argName> placeholders first, longest names first so a `$start`
  // arg can't truncate `$start_date`. Word-boundary tail prevents `$end`
  // from clipping `$endpoint`.
  const namedArgs = skill.arguments
    .map((argDef, i) => ({
      name: argDef.name,
      value: tokens[i] ?? argDef.default ?? "",
    }))
    .filter((a) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(a.name))
    .sort((a, b) => b.name.length - a.name.length);

  for (const { name, value } of namedArgs) {
    const re = new RegExp(`\\$${escapeRegex(name)}(?![A-Za-z0-9_])`, "g");
    result = result.replace(re, value);
  }

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

/**
 * Identify required arguments that have neither a positional token
 * nor a declared default. Used by the TUI to reject incomplete
 * slash-command invocations before sending to the LLM.
 */
export function validateSkillArgs(
  skill: SkillDefinition,
  rawArgs: string,
): { missing: string[] } {
  const tokens = tokenizeForSkill(rawArgs, skill);
  const missing: string[] = [];
  skill.arguments.forEach((argDef, i) => {
    if (!argDef.required) return;
    const hasToken = tokens[i] !== undefined;
    const hasDefault = argDef.default !== undefined;
    if (!hasToken && !hasDefault) missing.push(argDef.name);
  });
  return { missing };
}
