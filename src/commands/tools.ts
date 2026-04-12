import type { Command } from "commander";
import { z } from "zod";
import { getDbPath } from "../constants.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import {
  getToolsByGroup,
  type ToolDefinition,
  type ToolContext,
} from "../tools/tool.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import { DEFAULT_CONFIG } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";
import { registerAllTools } from "../tools/registry.ts";

registerAllTools();

const GROUP_DESCRIPTIONS: Record<string, string> = {
  dir: "Directory operations on the virtual filesystem",
  file: "File operations on the virtual filesystem",
  search: "Search the virtual filesystem",
};

export function registerToolCommands(program: Command) {
  for (const group of ["dir", "file", "search"]) {
    const groupCmd = program
      .command(group)
      .description(GROUP_DESCRIPTIONS[group] ?? `${group} tools`);

    for (const tool of getToolsByGroup(group)) {
      registerToolAsCLI(groupCmd, tool, program);
    }
  }
}

function registerToolAsCLI(
  parent: Command,
  tool: ToolDefinition<any, any>,
  program: Command,
) {
  // Derive subcommand name: "file_read" → "read", "file_count_lines" → "count-lines"
  const subName = tool.name.replace(/^[^_]+_/, "").replace(/_/g, "-");

  // Inspect zod schema to determine positional args and options
  const shape = tool.inputSchema.shape as Record<string, z.ZodType>;
  const positionals: string[] = [];
  const options: { key: string; flag: string; description: string; isArray: boolean }[] = [];

  for (const [key, schema] of Object.entries(shape)) {
    const desc = schema.description ?? key;
    const isOptional = schema.isOptional();
    const unwrapped = unwrapOptional(schema);

    if (isPositionalArg(key, tool.name)) {
      positionals.push(isOptional ? `[${key}]` : `<${key}>`);
    } else if (unwrapped instanceof z.ZodBoolean) {
      options.push({
        key,
        flag: `--${key.replace(/_/g, "-")}`,
        description: desc,
        isArray: false,
      });
    } else if (unwrapped instanceof z.ZodArray) {
      options.push({
        key,
        flag: `--${key.replace(/_/g, "-")} <json>`,
        description: desc,
        isArray: true,
      });
    } else {
      options.push({
        key,
        flag: `--${key.replace(/_/g, "-")} <value>`,
        description: desc,
        isArray: false,
      });
    }
  }

  const cmd = parent
    .command(`${subName} ${positionals.join(" ")}`.trim())
    .description(tool.description);

  for (const opt of options) {
    if (opt.isArray) {
      cmd.option(opt.flag, opt.description);
    } else {
      cmd.option(opt.flag, opt.description);
    }
  }

  cmd.action(async (...args: unknown[]) => {
    const dir = program.opts().dir;
    const conn = await getConnection(getDbPath(dir));
    await migrate(conn);

    try {
      const input = buildInput(
        tool,
        positionals,
        options,
        shape,
        args,
      );

      const ctx: ToolContext = {
        conn,
        projectDir: dir,
        config: DEFAULT_CONFIG as Required<BotholomewConfig>,
      };

      const result = await tool.execute(input, ctx);
      formatOutput(result, tool.name);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    } finally {
      conn.closeSync();
    }
  });
}

function buildInput(
  tool: ToolDefinition<any, any>,
  positionals: string[],
  options: { key: string; flag: string; description: string; isArray: boolean }[],
  shape: Record<string, z.ZodType>,
  args: unknown[],
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  // Positional args come first in Commander's action callback
  for (let i = 0; i < positionals.length; i++) {
    const key = positionals[i]!.replace(/[<>\[\]]/g, "");
    const value = args[i];
    if (value !== undefined) input[key] = value;
  }

  // Options object is the last argument before the Command object
  const optsObj = (args[positionals.length] ?? {}) as Record<string, unknown>;

  for (const opt of options) {
    const cliKey = opt.key.replace(/_/g, "-");
    // Commander converts --foo-bar to fooBar
    const camelKey = cliKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    let value = optsObj[camelKey] ?? optsObj[opt.key];

    if (value === undefined) continue;

    const unwrapped = unwrapOptional(shape[opt.key]!);

    // Parse JSON for array types
    if (opt.isArray && typeof value === "string") {
      value = JSON.parse(value);
    }
    // Parse numbers
    else if (unwrapped instanceof z.ZodNumber && typeof value === "string") {
      value = Number(value);
    }

    input[opt.key] = value;
  }

  // Validate with zod
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${JSON.stringify(parsed.error)}`);
  }

  return parsed.data;
}

function formatOutput(result: unknown, toolName: string) {
  if (result == null) return;

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;

    // Special formatting for known output shapes
    if ("tree" in obj && typeof obj.tree === "string") {
      console.log(obj.tree);
      return;
    }

    if ("content" in obj && typeof obj.content === "string") {
      console.log(obj.content);
      return;
    }

    if ("exists" in obj && typeof obj.exists === "boolean") {
      if (!obj.exists) process.exit(1);
      return;
    }

    if ("entries" in obj && Array.isArray(obj.entries)) {
      for (const entry of obj.entries) {
        const e = entry as { name: string; type: string; size: number };
        const suffix = e.type === "directory" ? "/" : "";
        console.log(`  ${e.name}${suffix}`);
      }
      return;
    }

    if ("matches" in obj && Array.isArray(obj.matches)) {
      for (const match of obj.matches) {
        if (typeof match === "string") {
          console.log(match);
        } else {
          const m = match as { path: string; line: number; content: string };
          console.log(`${m.path}:${m.line}: ${m.content}`);
        }
      }
      return;
    }

    // Default: print as JSON
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(result);
  }
}

function isPositionalArg(key: string, toolName: string): boolean {
  // These keys are treated as positional arguments
  const positionalKeys: Record<string, string[]> = {
    dir_create: ["path"],
    dir_list: ["path"],
    dir_tree: ["path"],
    dir_size: ["path"],
    file_read: ["path"],
    file_write: ["path"],
    file_edit: ["path"],
    file_delete: ["path"],
    file_copy: ["src", "dst"],
    file_move: ["src", "dst"],
    file_info: ["path"],
    file_exists: ["path"],
    file_count_lines: ["path"],
    search_find: ["pattern"],
    search_grep: ["pattern"],
    search_semantic: ["query"],
  };
  return positionalKeys[toolName]?.includes(key) ?? false;
}

function unwrapOptional(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) {
    return schema.unwrap();
  }
  return schema;
}
