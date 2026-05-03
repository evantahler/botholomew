import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { getMcpxDir } from "../constants.ts";
import { writeCapabilitiesFile } from "../context/capabilities.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { registerAllTools } from "../tools/registry.ts";
import { logger } from "../utils/logger.ts";

const require = createRequire(import.meta.url);
const ourPkg = require("../../package.json");
const mcpxPkg = require("@evantahler/mcpx/package.json");

if (mcpxPkg.version !== ourPkg.dependencies["@evantahler/mcpx"]) {
  throw new Error(
    `@evantahler/mcpx version mismatch: installed ${mcpxPkg.version}, expected ${ourPkg.dependencies["@evantahler/mcpx"]}`,
  );
}

const MCPX_CLI = fileURLToPath(import.meta.resolve("@evantahler/mcpx/cli"));

export async function runMcpx(
  projectDir: string,
  args: (string | undefined)[],
  opts?: { inherit?: boolean },
): Promise<string> {
  const mcpxDir = getMcpxDir(projectDir);
  const filteredArgs = args.filter((a): a is string => a !== undefined);
  const proc = Bun.spawn(["bun", MCPX_CLI, ...filteredArgs, "-c", mcpxDir], {
    stdout: opts?.inherit ? "inherit" : "pipe",
    stderr: opts?.inherit ? "inherit" : "pipe",
    stdin: opts?.inherit ? "inherit" : undefined,
  });
  const exitCode = await proc.exited;

  if (opts?.inherit) {
    if (exitCode !== 0) process.exit(exitCode);
    return "";
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) {
    logger.error(stderr.trim() || stdout.trim());
    process.exit(exitCode);
  }
  return stdout;
}

function getDir(program: Command): string {
  return program.opts().dir;
}

// Slice process.argv from the token after "mcpx" so flags (including --help)
// and positional args flow through to upstream mcpx verbatim.
function getRawMcpxArgs(): string[] {
  const idx = process.argv.indexOf("mcpx");
  return idx === -1 ? [] : process.argv.slice(idx + 1);
}

const PASSTHROUGH_SUBCOMMANDS: ReadonlyArray<[name: string, desc: string]> = [
  ["servers", "List configured MCP server names"],
  ["info", "Show server overview or schema for a specific tool"],
  ["search", "Search tools by keyword and/or semantic similarity"],
  ["exec", "Execute a tool call"],
  ["add", "Add an MCP server"],
  ["remove", "Remove an MCP server"],
  ["ping", "Check connectivity to MCP servers"],
  ["auth", "Authenticate with an HTTP MCP server"],
  ["deauth", "Remove stored authentication for a server"],
  ["resource", "List resources for a server, or read a specific resource"],
  ["prompt", "List prompts for a server, or get a specific prompt"],
  ["task", "Manage async tool tasks (list, get, result, cancel)"],
  ["index", "Build the search index from all configured servers"],
];

export function registerMcpxCommand(program: Command) {
  const mcpx = program
    .command("mcpx")
    .description("Manage MCP servers via MCPX");

  for (const [name, description] of PASSTHROUGH_SUBCOMMANDS) {
    mcpx
      .command(name)
      .description(description)
      .allowUnknownOption(true)
      .helpOption(false)
      .argument("[args...]", "arguments forwarded to mcpx")
      .action(async () => {
        await runMcpx(getDir(program), getRawMcpxArgs(), { inherit: true });
      });
  }

  // Upstream mcpx's "list" is the default action when invoked with no
  // subcommand — not a registered subcommand — so we strip the "list"
  // token before forwarding.
  mcpx
    .command("list")
    .description(
      "List all tools, resources, and prompts across all configured servers",
    )
    .allowUnknownOption(true)
    .helpOption(false)
    .argument("[args...]", "arguments forwarded to mcpx")
    .action(async () => {
      const raw = getRawMcpxArgs();
      const args = raw[0] === "list" ? raw.slice(1) : raw;
      await runMcpx(getDir(program), args, { inherit: true });
    });

  // Botholomew-specific: copy system-wide MCPX settings into this project.
  mcpx
    .command("import-global")
    .description("Copy system-wide MCPX settings (~/.mcpx) into this project")
    .action(async () => {
      const globalDir = join(homedir(), ".mcpx");
      if (!existsSync(globalDir)) {
        logger.error("No global MCPX config found at ~/.mcpx");
        process.exit(1);
      }

      const projectMcpxDir = getMcpxDir(getDir(program));
      if (!existsSync(projectMcpxDir)) {
        mkdirSync(projectMcpxDir, { recursive: true });
      }

      const filesToCopy = ["servers.json", "auth.json", "search.json"];
      let copied = 0;
      for (const file of filesToCopy) {
        const src = join(globalDir, file);
        if (!existsSync(src)) continue;
        const dest = join(projectMcpxDir, file);
        copyFileSync(src, dest);
        logger.success(`Copied ${file}`);
        copied++;
      }

      if (copied === 0) {
        logger.warn("No config files found in ~/.mcpx to copy.");
        return;
      }

      logger.success(
        `Imported ${copied} file(s) from ~/.mcpx into ${projectMcpxDir}`,
      );

      const projectDir = getDir(program);
      registerAllTools();
      const config = await loadConfig(projectDir);
      const mcpxClient = await createMcpxClient(projectDir);
      const spinner = createSpinner("Rebuilding capabilities.md").start();
      try {
        const result = await writeCapabilitiesFile(
          projectDir,
          mcpxClient,
          config,
          (phase) => spinner.update({ text: phase }),
        );
        spinner.success({
          text: `Rebuilt ${result.path} (${result.counts.internal} built-in, ${result.counts.mcp} MCPX)`,
        });
      } catch (err) {
        spinner.error({
          text: `Failed to rebuild capabilities.md: ${(err as Error).message}`,
        });
      } finally {
        await mcpxClient?.close();
      }
    });
}
