import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpxClient } from "@evantahler/mcpx";
import ansis from "ansis";
import type { Command } from "commander";
import { getMcpxDir, MCPX_SERVERS_FILENAME } from "../constants.ts";
import { createMcpxClient, formatCallToolResult } from "../mcpx/client.ts";
import { logger } from "../utils/logger.ts";

function getServersPath(program: Command): string {
  const dir = program.opts().dir;
  return join(getMcpxDir(dir), MCPX_SERVERS_FILENAME);
}

async function readServersFile(
  path: string,
): Promise<{ mcpServers: Record<string, unknown> }> {
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }
  return JSON.parse(await Bun.file(path).text());
}

async function writeServersFile(
  path: string,
  data: { mcpServers: Record<string, unknown> },
): Promise<void> {
  const dir = join(path, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function getClient(program: Command): Promise<McpxClient> {
  const dir = program.opts().dir;
  const client = await createMcpxClient(dir);
  if (!client) {
    logger.error(
      "No MCP servers configured. Add one with: botholomew mcpx add <name>",
    );
    process.exit(1);
  }
  return client;
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
      const serversPath = getServersPath(program);
      const data = await readServersFile(serversPath);
      const names = Object.keys(data.mcpServers);
      if (names.length === 0) {
        logger.dim("No MCP servers configured.");
        return;
      }
      for (const name of names) {
        console.log(`  ${ansis.bold(name)}`);
      }
    });

  // --- info ---
  mcpx
    .command("info <server> [tool]")
    .description("Show server overview, or schema for a specific tool")
    .action(async (server: string, tool?: string) => {
      const client = await getClient(program);
      try {
        if (tool) {
          const schema = await client.info(server, tool);
          if (!schema) {
            logger.error(`Tool not found: ${tool} on server ${server}`);
            process.exit(1);
          }
          console.log(ansis.bold(`${server} / ${schema.name}`));
          if (schema.description) console.log(`  ${schema.description}`);
          if (schema.inputSchema) {
            console.log(ansis.dim("\n  Input Schema:"));
            console.log(JSON.stringify(schema.inputSchema, null, 2));
          }
        } else {
          const info = await client.getServerInfo(server);
          console.log(ansis.bold(server));
          if (info.version?.name)
            console.log(`  Name:    ${info.version.name}`);
          if (info.version?.version)
            console.log(`  Version: ${info.version.version}`);
          if (info.instructions)
            console.log(`  Instructions: ${info.instructions}`);
          if (info.capabilities) {
            console.log(`  Capabilities: ${JSON.stringify(info.capabilities)}`);
          }

          const tools = await client.listTools(server);
          if (tools.length > 0) {
            console.log(ansis.dim(`\n  Tools (${tools.length}):`));
            for (const t of tools) {
              console.log(`    ${ansis.bold(t.tool.name)}`);
              if (t.tool.description) {
                const desc = t.tool.description.split("\n")[0] ?? "";
                console.log(`      ${ansis.dim(desc)}`);
              }
            }
          }
        }
      } finally {
        await client.close();
      }
    });

  // --- search ---
  mcpx
    .command("search <terms...>")
    .description("Search tools by keyword and/or semantic similarity")
    .action(async (terms: string[]) => {
      const client = await getClient(program);
      try {
        const results = await client.search(terms.join(" "));
        if (results.length === 0) {
          logger.dim("No matching tools found.");
          return;
        }
        for (const r of results) {
          const score = ansis.dim(`(${r.score.toFixed(2)})`);
          console.log(`  ${ansis.bold(r.server)}/${r.tool}  ${score}`);
          if (r.description) console.log(`    ${r.description}`);
        }
      } catch (err) {
        logger.error(
          `Search failed: ${err}. You may need to run: botholomew mcpx index`,
        );
        process.exit(1);
      } finally {
        await client.close();
      }
    });

  // --- exec ---
  mcpx
    .command("exec <server> <tool> [args-json]")
    .description("Execute a tool call")
    .action(async (server: string, tool: string, argsJson?: string) => {
      const client = await getClient(program);
      try {
        const args = argsJson ? JSON.parse(argsJson) : {};
        const result = await client.exec(server, tool, args);
        console.log(formatCallToolResult(result));
      } catch (err) {
        logger.error(`Exec failed: ${err}`);
        process.exit(1);
      } finally {
        await client.close();
      }
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
        const serversPath = getServersPath(program);
        const data = await readServersFile(serversPath);

        let entry: Record<string, unknown>;
        if (opts.url) {
          entry = { url: opts.url };
          if (opts.transport) entry.transport = opts.transport;
        } else if (opts.command) {
          entry = { command: opts.command };
          if (opts.args) entry.args = opts.args;
        } else {
          logger.error("Must specify --command or --url");
          process.exit(1);
        }

        if (opts.env) {
          const env: Record<string, string> = {};
          for (const pair of opts.env) {
            const eqIdx = pair.indexOf("=");
            if (eqIdx === -1) {
              logger.error(`Invalid env pair: ${pair} (expected KEY=VALUE)`);
              process.exit(1);
            }
            env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
          }
          entry.env = env;
        }

        data.mcpServers[name] = entry;
        await writeServersFile(serversPath, data);
        logger.success(`Added server: ${name}`);
      },
    );

  // --- remove ---
  mcpx
    .command("remove <name>")
    .description("Remove an MCP server")
    .action(async (name: string) => {
      const serversPath = getServersPath(program);
      const data = await readServersFile(serversPath);
      if (!(name in data.mcpServers)) {
        logger.error(`Server not found: ${name}`);
        process.exit(1);
      }
      delete data.mcpServers[name];
      await writeServersFile(serversPath, data);
      logger.success(`Removed server: ${name}`);
    });

  // --- ping ---
  mcpx
    .command("ping [servers...]")
    .description("Check connectivity to MCP servers")
    .action(async (servers: string[]) => {
      const client = await getClient(program);
      try {
        const names =
          servers.length > 0 ? servers : await client.getServerNames();
        for (const name of names) {
          try {
            const info = await client.getServerInfo(name);
            const version = info.version?.version ?? "unknown";
            console.log(
              `  ${ansis.green("✓")} ${ansis.bold(name)}  v${version}`,
            );
          } catch (err) {
            console.log(`  ${ansis.red("✗")} ${ansis.bold(name)}  ${err}`);
          }
        }
      } finally {
        await client.close();
      }
    });

  // --- auth ---
  mcpx
    .command("auth <server>")
    .description("Authenticate with an HTTP MCP server")
    .action(async (server: string) => {
      logger.info(
        `To authenticate, run: mcpx auth ${server} -c ${getMcpxDir(program.opts().dir)}`,
      );
    });

  // --- resource ---
  mcpx
    .command("resource [server] [uri]")
    .description("List resources for a server, or read a specific resource")
    .action(async (server?: string, uri?: string) => {
      const client = await getClient(program);
      try {
        if (server && uri) {
          const result = await client.readResource(server, uri);
          console.log(JSON.stringify(result, null, 2));
        } else {
          const resources = await client.listResources(server);
          if (resources.length === 0) {
            logger.dim("No resources found.");
            return;
          }
          for (const r of resources) {
            console.log(
              `  ${ansis.bold(r.server)}  ${r.resource.uri}  ${r.resource.name ?? ""}`,
            );
          }
        }
      } finally {
        await client.close();
      }
    });

  // --- prompt ---
  mcpx
    .command("prompt [server] [name] [args]")
    .description("List prompts for a server, or get a specific prompt")
    .action(async (server?: string, name?: string, argsJson?: string) => {
      const client = await getClient(program);
      try {
        if (server && name) {
          const args = argsJson ? JSON.parse(argsJson) : undefined;
          const result = await client.getPrompt(server, name, args);
          console.log(JSON.stringify(result, null, 2));
        } else {
          const prompts = await client.listPrompts(server);
          if (prompts.length === 0) {
            logger.dim("No prompts found.");
            return;
          }
          for (const p of prompts) {
            console.log(
              `  ${ansis.bold(p.server)}  ${p.prompt.name}  ${p.prompt.description ?? ""}`,
            );
          }
        }
      } finally {
        await client.close();
      }
    });

  // --- task ---
  mcpx
    .command("task <action> <server> [taskId]")
    .description("Manage async tasks (actions: list, get, result, cancel)")
    .action(async (action: string, server: string, taskId?: string) => {
      const client = await getClient(program);
      try {
        switch (action) {
          case "list": {
            const result = await client.listTasks(server);
            console.log(JSON.stringify(result, null, 2));
            break;
          }
          case "get": {
            if (!taskId) {
              logger.error("Task ID required for get");
              process.exit(1);
            }
            const result = await client.getTask(server, taskId);
            console.log(JSON.stringify(result, null, 2));
            break;
          }
          case "result": {
            if (!taskId) {
              logger.error("Task ID required for result");
              process.exit(1);
            }
            const result = await client.getTaskResult(server, taskId);
            console.log(formatCallToolResult(result));
            break;
          }
          case "cancel": {
            if (!taskId) {
              logger.error("Task ID required for cancel");
              process.exit(1);
            }
            const result = await client.cancelTask(server, taskId);
            console.log(JSON.stringify(result, null, 2));
            break;
          }
          default:
            logger.error(
              `Unknown action: ${action}. Use list, get, result, or cancel.`,
            );
            process.exit(1);
        }
      } finally {
        await client.close();
      }
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

      const projectMcpxDir = getMcpxDir(program.opts().dir);
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
      const mcpxDir = getMcpxDir(program.opts().dir);
      const proc = Bun.spawn(["mcpx", "index", "-c", mcpxDir], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });
}
