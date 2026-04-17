import type { SlashCommand } from "../skills/commands.ts";

export const MAX_VISIBLE_COMPLETIONS = 8;

const SLASH_QUERY = /^\/([\w-]*)$/;

/**
 * Given the current input value, return the list of slash commands that
 * should appear in the autocomplete popup. Returns `null` when the popup
 * should not be shown at all (e.g. the input isn't a slash query, or the
 * user has already typed a space to start writing arguments).
 */
export function getSlashMatches(
  value: string,
  commands: SlashCommand[],
): SlashCommand[] | null {
  const match = SLASH_QUERY.exec(value);
  if (!match) return null;

  const query = (match[1] ?? "").toLowerCase();
  const filtered = commands.filter((c) =>
    c.name.toLowerCase().startsWith(query),
  );
  if (filtered.length === 0) return null;

  return filtered.slice(0, MAX_VISIBLE_COMPLETIONS);
}

export function buildSlashCommands(
  builtins: SlashCommand[],
  skills: Iterable<{ name: string; description: string }>,
): SlashCommand[] {
  const out: SlashCommand[] = [...builtins];
  for (const s of skills) {
    out.push({ name: s.name, description: s.description });
  }
  return out;
}
