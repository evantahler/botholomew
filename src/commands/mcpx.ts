import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { getMcpxDir } from "../constants.ts";
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

export function registerMcpxCommand(program: Command) {
  const mcpx = program
    .command("mcpx")
    .description("Manage MCP servers via MCPX");

  // --- servers ---
  mcpx
    .command("servers")
    .description("List configured MCP server names")
    .action(async () => {
      const out = await runMcpx(getDir(program), ["servers"]);
      process.stdout.write(out);
    });

  // --- info ---
  mcpx
    .command("info <first> [second]")
    .description(
      "Show server overview, or schema for a specific tool (server is optional if tool name is unambiguous)",
    )
    .action(async (first: string, second?: string) => {
      const out = await runMcpx(getDir(program), ["info", first, second]);
      process.stdout.write(out);
    });

  // --- search ---
  mcpx
    .command("search <terms...>")
    .description("Search tools by keyword and/or semantic similarity")
    .action(async (terms: string[]) => {
      const out = await runMcpx(getDir(program), ["search", ...terms]);
      process.stdout.write(out);
    });

  // --- exec ---
  mcpx
    .command("exec <first> [second] [third]")
    .description(
      "Execute a tool call (server is optional if tool name is unambiguous)",
    )
    .action(async (first: string, second?: string, third?: string) => {
      const out = await runMcpx(getDir(program), [
        "exec",
        first,
        second,
        third,
      ]);
      process.stdout.write(out);
    });

  // --- add ---
  mcpx
    .command("add <name>")
    .description("Add an MCP server")
    .option("--command <cmd>", "Stdio server command")
    .option("--args <args...>", "Stdio server arguments")
    .option("--url <url>", "HTTP server URL")
    .option("--transport <type>", "HTTP transport: sse or streamable-http")
    .option("--env <pairs...>", "Environment variables as KEY=VALUE pairs")
    .action(
      async (
        name: string,
        opts: {
          command?: string;
          args?: string[];
          url?: string;
          transport?: string;
          env?: string[];
        },
      ) => {
        const cliArgs: string[] = ["add", name];
        if (opts.command) cliArgs.push("--command", opts.command);
        if (opts.args) {
          for (const a of opts.args) cliArgs.push("--args", a);
        }
        if (opts.url) cliArgs.push("--url", opts.url);
        if (opts.transport) cliArgs.push("--transport", opts.transport);
        if (opts.env) {
          for (const e of opts.env) cliArgs.push("--env", e);
        }
        const out = await runMcpx(getDir(program), cliArgs);
        process.stdout.write(out);
      },
    );

  // --- remove ---
  mcpx
    .command("remove <name>")
    .description("Remove an MCP server")
    .action(async (name: string) => {
      const out = await runMcpx(getDir(program), ["remove", name]);
      process.stdout.write(out);
    });

  // --- ping ---
  mcpx
    .command("ping [servers...]")
    .description("Check connectivity to MCP servers")
    .action(async (servers: string[]) => {
      const out = await runMcpx(getDir(program), ["ping", ...servers]);
      process.stdout.write(out);
    });

  // --- auth ---
  mcpx
    .command("auth <server>")
    .description("Authenticate with an HTTP MCP server")
    .action(async (server: string) => {
      await runMcpx(getDir(program), ["auth", server], { inherit: true });
    });

  // --- resource ---
  mcpx
    .command("resource [server] [uri]")
    .description("List resources for a server, or read a specific resource")
    .action(async (server?: string, uri?: string) => {
      const out = await runMcpx(getDir(program), ["resource", server, uri]);
      process.stdout.write(out);
    });

  // --- prompt ---
  mcpx
    .command("prompt [server] [name] [args]")
    .description("List prompts for a server, or get a specific prompt")
    .action(async (server?: string, name?: string, argsJson?: string) => {
      const out = await runMcpx(getDir(program), [
        "prompt",
        server,
        name,
        argsJson,
      ]);
      process.stdout.write(out);
    });

  // --- task ---
  mcpx
    .command("task <action> <server> [taskId]")
    .description("Manage async tasks (actions: list, get, result, cancel)")
    .action(async (action: string, server: string, taskId?: string) => {
      const out = await runMcpx(getDir(program), [
        "task",
        action,
        server,
        taskId,
      ]);
      process.stdout.write(out);
    });

  // --- import-global ---
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
      } else {
        logger.success(
          `Imported ${copied} file(s) from ~/.mcpx into ${projectMcpxDir}`,
        );
      }
    });

  // --- index ---
  mcpx
    .command("index")
    .description("Build the search index from all configured servers")
    .action(async () => {
      await runMcpx(getDir(program), ["index"], { inherit: true });
    });
}
