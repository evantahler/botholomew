import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import { resolveMembotDir } from "../mem/client.ts";
import { pkg as ourPkg } from "../pkg.ts";
import { IS_COMPILED_BINARY, MEMBOT_CLI_SENTINEL } from "../runtime.ts";
import { logger } from "../utils/logger.ts";

// Resolve the upstream membot CLI lazily. `import.meta.resolve` walks
// node_modules on disk, which a `bun build --compile` binary doesn't have, so
// resolving at module load would crash *every* command. On first use we resolve
// it, soft-check version drift, and fail this passthrough alone with a clear
// message when membot isn't reachable (e.g. inside the standalone binary).
let membotCli: string | null | undefined;
function resolveMembotCli(): string {
  if (membotCli === undefined) {
    membotCli = null;
    try {
      const cli = fileURLToPath(import.meta.resolve("membot/cli"));
      if (existsSync(cli)) {
        membotCli = cli;
        try {
          const require = createRequire(import.meta.url);
          const membotPkg = require("membot/package.json");
          const requested = (ourPkg.dependencies.membot as string).replace(
            /^[\^~]/,
            "",
          );
          if (!membotPkg.version.startsWith(requested.split(".")[0])) {
            logger.warn(
              `membot version drift: installed ${membotPkg.version}, expected ${ourPkg.dependencies.membot}`,
            );
          }
        } catch {
          // best-effort version check — ignore if package.json isn't readable
        }
      }
    } catch {
      // unresolvable (e.g. standalone binary) — handled below
    }
  }
  if (!membotCli) {
    logger.error(
      "The `botholomew membot` passthrough requires a reachable membot install, which the standalone binary doesn't bundle. Install botholomew via npm/Bun, or run `membot` directly.",
    );
    process.exit(1);
  }
  return membotCli;
}

function getDir(program: Command): string {
  return program.opts().dir;
}

/**
 * Slice process.argv from the token after "membot" so flags (including
 * --help) and positional args flow through to upstream membot verbatim.
 */
function getRawMembotArgs(): string[] {
  const idx = process.argv.indexOf("membot");
  return idx === -1 ? [] : process.argv.slice(idx + 1);
}

async function runMembot(projectDir: string, args: string[]): Promise<number> {
  // Resolve membot's data dir from `membot_scope`:
  //   - "global"  → ~/.membot (default, shared)
  //   - "project" → <projectDir>
  // Forward stdio so the user sees the same output they would running
  // `membot` directly.
  const config = await loadConfig(projectDir);
  const membotDir = resolveMembotDir(projectDir, config);
  // In the compiled binary, re-exec ourselves with the sentinel so the bundled
  // membot CLI runs; under Bun, spawn the resolved on-disk membot CLI.
  const cmd = IS_COMPILED_BINARY
    ? [process.execPath, MEMBOT_CLI_SENTINEL, "--config", membotDir, ...args]
    : ["bun", resolveMembotCli(), "--config", membotDir, ...args];
  const proc = Bun.spawn(cmd, {
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
    .action(async (opts: { force: boolean }) => {
      const globalDir = join(homedir(), ".membot");
      if (!existsSync(globalDir)) {
        logger.error("No global membot data found at ~/.membot");
        process.exit(1);
      }

      const projectDir = getDir(program);
      const config = await loadConfig(projectDir);
      if (config.membot_scope !== "project") {
        logger.warn(
          `membot_scope is "${config.membot_scope}" — Botholomew currently reads from ~/.membot. After this import, set membot_scope to "project" in ${getDir(program)}/config/config.json for the project-local copy to take effect.`,
        );
      }
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

export function registerMembotCommand(program: Command) {
  // The `membot` group is a thin passthrough: every token after `membot`
  // (subcommand, flags, and positional args) is forwarded verbatim to the
  // upstream membot CLI, which owns the canonical schema. We do NOT enumerate
  // membot's subcommands here — doing so (a) silently dropped membot's
  // management commands that aren't agent Operations (`config`, `reindex`,
  // `router`, `login`, `logs`, `check-update`, …) and (b) gave a misleading
  // "too many arguments" error for them. `passThroughOptions()` (paired with
  // `enablePositionalOptions()` on the root) keeps Commander from swallowing
  // flags meant for membot — notably `--version <timestamp>`, which the root
  // `--version` would otherwise intercept.
  const membot = program
    .command("membot")
    .description(
      "Manage the project's knowledge store (passthrough to membot: add, search, ls, read, …). Run `botholomew membot <command> --help` for upstream command help.",
    )
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("[args...]", "arguments forwarded to membot")
    .action(async () => {
      const exitCode = await runMembot(getDir(program), getRawMembotArgs());
      if (exitCode !== 0) process.exit(exitCode);
    });

  // Botholomew-specific helper. Registered as a real subcommand so it's matched
  // before the passthrough action and shows up in `botholomew membot --help`.
  registerImportGlobal(membot, program);
}
