import type { SkillDefinition } from "./parser.ts";
import { renderSkill, tokenizeForSkill, validateSkillArgs } from "./parser.ts";

export interface SlashCommand {
  name: string;
  description: string;
  takesArgs?: boolean;
}

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show command reference and shortcuts" },
  { name: "skills", description: "List available skills" },
  { name: "clear", description: "End current thread and start a new one" },
  { name: "exit", description: "End the chat session" },
];

export interface QueueUserMessageOptions {
  display?: string;
}

export interface SlashCommandContext {
  skills: Map<string, SkillDefinition>;
  addSystemMessage: (content: string) => void;
  queueUserMessage: (content: string, opts?: QueueUserMessageOptions) => void;
  exit: () => void;
  clearChat?: () => void;
}

export function formatSkillUsage(skill: SkillDefinition): string {
  const parts = [`/${skill.name}`];
  for (const arg of skill.arguments) {
    if (arg.required && arg.default === undefined) {
      parts.push(`<${arg.name}>`);
    } else if (arg.default !== undefined) {
      parts.push(`[${arg.name}=${arg.default}]`);
    } else {
      parts.push(`[${arg.name}]`);
    }
  }
  return parts.join(" ");
}

/**
 * Detect when a multi-arg skill received unquoted whitespace-separated
 * input that the greedy-last splitter has packed into the final slot.
 * The user almost certainly intended one of the words to belong to a
 * different slot (or the whole thing to be a single argument), so we
 * surface a parse breakdown instead of silently committing to one
 * interpretation.
 *
 * Returns null when the input is unambiguous and may proceed.
 */
export function detectAmbiguousSplit(
  skill: SkillDefinition,
  rawArgs: string,
): { tokens: string[] } | null {
  if (skill.arguments.length < 2) return null;
  if (rawArgs.includes('"') || rawArgs.includes("'")) return null;
  const tokens = tokenizeForSkill(rawArgs, skill);
  const last = tokens[tokens.length - 1];
  if (!last || !/\s/.test(last)) return null;
  return { tokens };
}

function formatAmbiguityHint(skill: SkillDefinition, tokens: string[]): string {
  const slots: string[] = [];
  const nameWidth = skill.arguments.reduce(
    (m, a) => Math.max(m, a.name.length),
    0,
  );
  skill.arguments.forEach((argDef, i) => {
    const value =
      tokens[i] !== undefined
        ? `"${tokens[i]}"`
        : argDef.default !== undefined
          ? `"${argDef.default}" (default)`
          : "(unset)";
    slots.push(`  ${argDef.name.padEnd(nameWidth)} = ${value}`);
  });

  const firstWord = tokens[0] ?? "";
  const restPreview = tokens.slice(1).join(" ");
  const fullPreview = [firstWord, restPreview].filter(Boolean).join(" ");

  return [
    `/${skill.name}: ambiguous input. Parsed as:`,
    ...slots,
    "",
    "Quote the multi-word argument to confirm, e.g.:",
    `  /${skill.name} "${fullPreview}"`,
    `  /${skill.name} '${firstWord}' '${restPreview}'`,
  ].join("\n");
}

/**
 * Handle a slash-command input. Returns true if the command was consumed
 * (recognized or errored), false if it should fall through.
 */
export function handleSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): boolean {
  const spaceIdx = input.indexOf(" ");
  const commandPart = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rawArgs = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();
  const name = commandPart.slice(1).toLowerCase(); // remove leading /

  // Built-in commands
  if (name === "exit") {
    ctx.exit();
    return true;
  }

  if (name === "clear") {
    if (ctx.clearChat) {
      ctx.clearChat();
    } else {
      ctx.addSystemMessage("/clear is only available in the chat TUI.");
    }
    return true;
  }

  if (name === "skills") {
    if (ctx.skills.size === 0) {
      ctx.addSystemMessage("No skills loaded. Add .md files to skills/");
    } else {
      const lines = ["Available skills:"];
      for (const [skillName, skill] of ctx.skills) {
        lines.push(
          `  /${skillName.padEnd(16)} ${skill.description || "(no description)"}`,
        );
      }
      ctx.addSystemMessage(lines.join("\n"));
    }
    return true;
  }

  // Skill dispatch
  const skill = ctx.skills.get(name);
  if (skill) {
    const { missing } = validateSkillArgs(skill, rawArgs);
    if (missing.length > 0) {
      ctx.addSystemMessage(
        `/${skill.name}: missing required argument(s): ${missing.join(", ")}\n` +
          `Usage: ${formatSkillUsage(skill)}`,
      );
      return true;
    }
    const ambiguous = detectAmbiguousSplit(skill, rawArgs);
    if (ambiguous) {
      ctx.addSystemMessage(formatAmbiguityHint(skill, ambiguous.tokens));
      return true;
    }
    const rendered = renderSkill(skill, rawArgs);
    ctx.queueUserMessage(rendered, { display: input });
    return true;
  }

  // Unknown command
  ctx.addSystemMessage(
    `Unknown command: /${name}. Type /skills to see available commands.`,
  );
  return true;
}
