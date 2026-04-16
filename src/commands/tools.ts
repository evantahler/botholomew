import type { Command } from "commander";
import { z } from "zod";
import { loadConfig } from "../config/loader.ts";
import { registerAllTools } from "../tools/registry.ts";
import {
  type AnyToolDefinition,
  getToolsByGroup,
  type ToolContext,
} from "../tools/tool.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

registerAllTools();

/**
 * Register context tool subcommands (read, write, edit, etc.) onto an
 * existing Commander command. Skips tools whose derived subcommand name
 * collides with an already-registered subcommand on the parent.
 */
export function registerContextToolSubcommands(parent: Command) {
  const existing = new Set(parent.commands.map((c: Command) => c.name()));

  for (const tool of getToolsByGroup("context")) {
    const subName = deriveSubName(tool.name);
    if (existing.has(subName)) continue; // skip conflicts with management subcommands
    registerToolAsCLI(parent, tool);
  }
}

/**
 * Register search tool subcommands (grep, semantic) onto an
 * existing Commander command (e.g. the "context search" group).
 */
export function registerSearchToolSubcommands(parent: Command) {
  for (const tool of getToolsByGroup("search")) {
    registerToolAsCLI(parent, tool);
  }
}

/** Derive CLI subcommand name from tool name: "context_read" → "read", "context_list_dir" → "list-dir" */
function deriveSubName(toolName: string): string {
  return toolName.replace(/^[^_]+_/, "").replace(/_/g, "-");
}

function registerToolAsCLI(parent: Command, tool: AnyToolDefinition) {
  const subName = deriveSubName(tool.name);

  // Inspect zod schema to determine positional args and options
  const shape = tool.inputSchema.shape as Record<string, z.ZodType>;
  const positionals: string[] = [];
  const options: {
    key: string;
    flag: string;
    description: string;
    isArray: boolean;
  }[] = [];

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

  cmd.action((...args: unknown[]) =>
    withDb(parent.parent ?? parent, async (conn, dir) => {
      try {
        const input = buildInput(tool, positionals, options, shape, args);

        const ctx: ToolContext = {
          conn,
          projectDir: dir,
          config: await loadConfig(dir),
          mcpxClient: null,
        };

        const result = await tool.execute(input, ctx);
        formatOutput(result, tool.name);
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    }),
  );
}

function buildInput(
  tool: AnyToolDefinition,
  positionals: string[],
  options: {
    key: string;
    flag: string;
    description: string;
    isArray: boolean;
  }[],
  shape: Record<string, z.ZodType>,
  args: unknown[],
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  // Positional args come first in Commander's action callback
  for (let i = 0; i < positionals.length; i++) {
    const key = positionals[i]?.replace(/[<>[\]]/g, "");
    const value = args[i];
    if (key !== undefined && value !== undefined) input[key] = value;
  }

  // Options object is the last argument before the Command object
  const optsObj = (args[positionals.length] ?? {}) as Record<string, unknown>;

  for (const opt of options) {
    const cliKey = opt.key.replace(/_/g, "-");
    // Commander converts --foo-bar to fooBar
    const camelKey = cliKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    let value = optsObj[camelKey] ?? optsObj[opt.key];

    if (value === undefined) continue;

    const schemaForKey = shape[opt.key];
    if (!schemaForKey) continue;
    const unwrapped = unwrapOptional(schemaForKey);

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

function formatOutput(result: unknown, _toolName: string) {
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
    context_create_dir: ["path"],
    context_list_dir: ["path"],
    context_tree: ["path"],
    context_dir_size: ["path"],
    context_read: ["path"],
    context_write: ["path"],
    context_edit: ["path"],
    context_delete: ["path"],
    context_copy: ["src", "dst"],
    context_move: ["src", "dst"],
    context_info: ["path"],
    context_exists: ["path"],
    context_count_lines: ["path"],
    context_search: ["query"],
    search_grep: ["pattern"],
    search_semantic: ["query"],
  };
  return positionalKeys[toolName]?.includes(key) ?? false;
}

function unwrapOptional(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) {
    return schema.unwrap() as z.ZodType;
  }
  return schema;
}
