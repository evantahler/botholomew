import { join } from "node:path";
import ansis from "ansis";
import type { Command } from "commander";
import { getSkillsDir } from "../constants.ts";
import { loadSkills } from "../skills/loader.ts";
import { parseSkillFile } from "../skills/parser.ts";
import { logger } from "../utils/logger.ts";

export function registerSkillCommand(program: Command) {
  const skill = program
    .command("skill")
    .description("Manage skill slash-commands");

  skill
    .command("validate [file]")
    .description("Validate skill files in .botholomew/skills/")
    .action(async (file?: string) => {
      const dir = program.opts().dir;

      if (file) {
        await validateSingleFile(file);
      } else {
        await validateAllSkills(dir);
      }
    });

  skill
    .command("create <name>")
    .description("Create a new skill file from a template")
    .option("--force", "overwrite existing file")
    .action(async (name: string, opts: { force?: boolean }) => {
      const dir = program.opts().dir;
      const skillsDir = getSkillsDir(dir);
      const normalized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const filePath = join(skillsDir, `${normalized}.md`);

      if (!opts.force && (await Bun.file(filePath).exists())) {
        logger.error(`Skill file already exists: ${filePath}`);
        logger.dim("Use --force to overwrite.");
        process.exit(1);
      }

      const template = `---
name: ${normalized}
description: ""
arguments: []
---

Your prompt template here. Use $ARGUMENTS for the full argument string
or $1, $2, etc. for positional arguments.
`;

      await Bun.write(filePath, template);
      logger.success(`Created skill: ${filePath}`);
    });
}

async function validateSingleFile(filePath: string): Promise<void> {
  try {
    const raw = await Bun.file(filePath).text();
    const skill = parseSkillFile(raw, filePath);
    logger.success(`${ansis.bold(skill.name)} — valid`);
    if (skill.description) logger.dim(`  ${skill.description}`);
    if (skill.arguments.length > 0) {
      logger.dim(`  ${skill.arguments.length} argument(s)`);
    }
  } catch (e) {
    logger.error(`${filePath}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

async function validateAllSkills(dir: string): Promise<void> {
  let hasErrors = false;

  try {
    const skills = await loadSkills(dir);

    if (skills.size === 0) {
      logger.dim("No skill files found.");
      return;
    }

    for (const [name, skill] of skills) {
      const argCount = skill.arguments.length;
      const args = argCount > 0 ? `${argCount} arg(s)` : "no args";
      logger.success(
        `${ansis.bold(name).padEnd(20)} ${skill.description || ansis.dim("(no description)")}  ${ansis.dim(`[${args}]`)}`,
      );
    }

    logger.info("");
    logger.dim(`${skills.size} skill(s) validated.`);
  } catch (e) {
    logger.error(`Validation failed: ${e instanceof Error ? e.message : e}`);
    hasErrors = true;
  }

  if (hasErrors) process.exit(1);
}
