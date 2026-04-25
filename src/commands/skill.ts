import { join, relative } from "node:path";
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
    .command("list")
    .description("List all skills loaded from .botholomew/skills/")
    .option("-l, --limit <n>", "max number of skills", Number.parseInt)
    .option("-o, --offset <n>", "skip first N skills", Number.parseInt)
    .action(async (opts: { limit?: number; offset?: number }) => {
      const dir = program.opts().dir;
      const skills = await loadSkills(dir);

      if (skills.size === 0) {
        logger.dim("No skill files found.");
        return;
      }

      const sorted = [...skills.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const total = sorted.length;
      const start = opts.offset ?? 0;
      const end = opts.limit ? start + opts.limit : undefined;
      const page = sorted.slice(start, end);

      if (page.length === 0) {
        logger.dim(`No skills on this page (total: ${total}).`);
        return;
      }

      const header = `${ansis.bold("Name".padEnd(20))} ${ansis.bold("Description".padEnd(40))} ${ansis.bold("Args".padEnd(20))} ${ansis.bold("Path")}`;
      console.log(header);
      console.log("-".repeat(header.length));

      for (const s of page) {
        const name = s.name.padEnd(20);
        const desc = s.description
          ? s.description.slice(0, 39).padEnd(40)
          : ansis.dim("(no description)".padEnd(40));
        const args =
          s.arguments.length > 0
            ? s.arguments
                .map((a) => a.name)
                .join(",")
                .slice(0, 19)
                .padEnd(20)
            : ansis.dim("none".padEnd(20));
        const path = relative(dir, s.filePath);
        console.log(`${name} ${desc} ${args} ${path}`);
      }

      const footer =
        page.length === total
          ? `${total} skill(s)`
          : `showing ${page.length} of ${total} skill(s)`;
      console.log(`\n${ansis.dim(footer)}`);
    });

  skill
    .command("show <name>")
    .description("Print the raw contents of a skill file")
    .action(async (name: string) => {
      const dir = program.opts().dir;
      const skills = await loadSkills(dir);
      const s = skills.get(name.toLowerCase());

      if (!s) {
        logger.error(`Skill not found: ${name}`);
        if (skills.size > 0) {
          const available = [...skills.keys()].sort().join(", ");
          console.error(ansis.dim(`Available: ${available}`));
        }
        process.exit(1);
      }

      const raw = await Bun.file(s.filePath).text();
      process.stdout.write(raw);
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

  skill
    .command("delete <name>")
    .description("Delete a skill file")
    .action(async (name: string) => {
      const dir = program.opts().dir;
      const skills = await loadSkills(dir);
      const s = skills.get(name.toLowerCase());

      if (!s) {
        logger.error(`Skill not found: ${name}`);
        if (skills.size > 0) {
          const available = [...skills.keys()].sort().join(", ");
          console.error(ansis.dim(`Available: ${available}`));
        }
        process.exit(1);
      }

      await Bun.file(s.filePath).delete();
      logger.success(`Deleted skill: ${s.filePath}`);
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
