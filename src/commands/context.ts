import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { defaultCliName, OPERATIONS } from "membot";
import { logger } from "../utils/logger.ts";

const require = createRequire(import.meta.url);
const ourPkg = require("../../package.json");
const membotPkg = require("membot/package.json");

// Soft warning rather than a hard error — membot's SDK API is stable within a
// minor version, and dev workspaces sometimes pin a newer copy.
const requested = (ourPkg.dependencies.membot as string).replace(/^[\^~]/, "");
if (!membotPkg.version.startsWith(requested.split(".")[0])) {
  logger.warn(
    `membot version drift: installed ${membotPkg.version}, expected ${ourPkg.dependencies.membot}`,
  );
}

const MEMBOT_CLI = fileURLToPath(import.meta.resolve("membot/cli"));

function getDir(program: Command): string {
  return program.opts().dir;
}

/**
 * Slice process.argv from the token after "context" so flags (including
 * --help) and positional args flow through to upstream membot verbatim.
 */
function getRawContextArgs(): string[] {
  const idx = process.argv.indexOf("context");
  return idx === -1 ? [] : process.argv.slice(idx + 1);
}

async function runMembot(projectDir: string, args: string[]): Promise<number> {
  // Point membot at <projectDir> as its data dir via the `--config` flag —
  // each Botholomew project gets its own membot store at
  // `<projectDir>/index.duckdb`. Forward stdio so the user sees the same
  // output they would running `membot` directly.
  const proc = Bun.spawn(["bun", MEMBOT_CLI, "--config", projectDir, ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

/**
 * Copy the system-wide `~/.membot` data dir into the project, mirroring
 * `botholomew mcpx import-global`. Useful when the user has built up a
 * personal knowledge base globally and wants to seed a new project with it.
 *
 * Refuses to overwrite a non-empty project membot store unless `--force` is
 * passed — accidentally clobbering an active project's index is much worse
 * than re-running the import.
 */
function registerImportGlobal(parent: Command, program: Command): void {
  parent
    .command("import-global")
    .description("Copy system-wide membot data (~/.membot) into this project")
    .option(
      "-f, --force",
      "Overwrite an existing index.duckdb in the project",
      false,
    )
    .action((opts: { force: boolean }) => {
      const globalDir = join(homedir(), ".membot");
      if (!existsSync(globalDir)) {
        logger.error("No global membot data found at ~/.membot");
        process.exit(1);
      }

      const projectDir = getDir(program);
      const dest = (name: string) => join(projectDir, name);
      const destDb = dest("index.duckdb");

      if (existsSync(destDb) && !opts.force) {
        const stat = statSync(destDb);
        if (stat.size > 0) {
          logger.error(
            `Refusing to overwrite ${destDb} (${stat.size} bytes). Pass --force to replace it.`,
          );
          process.exit(1);
        }
      }

      mkdirSync(projectDir, { recursive: true });

      const filesToCopy = ["index.duckdb", "config.json"];
      let copied = 0;
      for (const file of filesToCopy) {
        const src = join(globalDir, file);
        if (!existsSync(src)) continue;
        copyFileSync(src, dest(file));
        logger.success(`Copied ${file}`);
        copied++;
      }

      if (copied === 0) {
        logger.warn("No files found in ~/.membot to copy.");
        return;
      }

      logger.success(
        `Imported ${copied} file(s) from ~/.membot into ${projectDir}`,
      );
    });
}

export function registerContextCommand(program: Command) {
  const context = program
    .command("context")
    .description(
      "Manage the project's knowledge store via membot (add, search, ls, read, …)",
    );

  // Botholomew-specific helpers first so they show up before the membot
  // passthrough subcommands in --help.
  registerImportGlobal(context, program);

  // One Commander subcommand per membot Operation. We don't redeclare any
  // flags — Commander hands the raw argv slice to membot, which owns the
  // canonical schema.
  for (const op of OPERATIONS) {
    const name = defaultCliName(op);
    context
      .command(name)
      .description(op.description.split("\n")[0] ?? op.description)
      .allowUnknownOption(true)
      .helpOption(false)
      .argument("[args...]", "arguments forwarded to membot")
      .action(async () => {
        const exitCode = await runMembot(getDir(program), getRawContextArgs());
        if (exitCode !== 0) process.exit(exitCode);
      });
  }

  // `botholomew context` (no subcommand) → membot's default action.
  context.action(async () => {
    const exitCode = await runMembot(getDir(program), getRawContextArgs());
    if (exitCode !== 0) process.exit(exitCode);
  });
}
