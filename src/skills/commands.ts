import type { SkillDefinition } from "./parser.ts";
import { renderSkill } from "./parser.ts";

export interface SlashCommand {
  name: string;
  description: string;
}

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show command reference and shortcuts" },
  { name: "skills", description: "List available skills" },
  { name: "exit", description: "End the chat session" },
];

export interface SlashCommandContext {
  skills: Map<string, SkillDefinition>;
  addSystemMessage: (content: string) => void;
  queueUserMessage: (content: string) => void;
  exit: () => void;
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

  if (name === "skills") {
    if (ctx.skills.size === 0) {
      ctx.addSystemMessage(
        "No skills loaded. Add .md files to .botholomew/skills/",
      );
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
    const rendered = renderSkill(skill, rawArgs);
    ctx.addSystemMessage(`Running skill: ${skill.name}`);
    ctx.queueUserMessage(rendered);
    return true;
  }

  // Unknown command
  ctx.addSystemMessage(
    `Unknown command: /${name}. Type /skills to see available commands.`,
  );
  return true;
}
