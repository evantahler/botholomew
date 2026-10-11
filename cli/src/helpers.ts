import type { Command } from "commander";
import { helpBanner } from "./banner.ts";
import { ApiError, apiRequest } from "./client.ts";
import {
  type CliContext,
  contextFromCommand,
  requireSession,
} from "./context.ts";
import { printError, printResult } from "./output.ts";

/**
 * Attach the help banner to a command and its descendants.
 * @param command - The command to decorate.
 * @returns The same command.
 */
export function decorateHelp(command: Command): Command {
  command.addHelpText("beforeAll", () => {
    if (process.argv.includes("--json")) return "";
    const noColor =
      process.argv.includes("--no-color") ||
      (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "");
    return helpBanner(!noColor);
  });
  return command;
}

/**
 * Run a CLI action, printing errors to stderr and setting the process exit code.
 * @param command - The Commander command (for globals).
 * @param fn - The work to do. Return a number to use as the exit code.
 */
export async function runAction(
  command: Command,
  fn: (ctx: CliContext) => Promise<number | void>,
): Promise<void> {
  const ctx = contextFromCommand(command);
  try {
    const code = await fn(ctx);
    if (typeof code === "number" && code !== 0) process.exit(code);
  } catch (error) {
    const message =
      error instanceof ApiError || error instanceof Error
        ? error.message
        : String(error);
    printError(message, ctx.color);
    process.exit(1);
  }
}

/**
 * Call the API with the session cookie from context.
 * @param ctx - CLI context.
 * @param method - HTTP method.
 * @param path - Path under `/api`.
 * @param options - Query and/or JSON body.
 * @returns The parsed JSON body.
 */
export async function sessionRequest(
  ctx: CliContext,
  method: string,
  path: string,
  options: {
    query?: Record<string, unknown>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  return await apiRequest(ctx.url, {
    method,
    path,
    query: options.query,
    body: options.body,
    sessionCookie: requireSession(ctx),
  });
}

/**
 * Print an API payload (`--json` or colorized JSON).
 * @param ctx - CLI context.
 * @param value - Anything JSON-serializable.
 */
export function emit(ctx: CliContext, value: unknown): void {
  printResult(value, ctx.json, ctx.color);
}

/**
 * Drop keys whose value is `undefined` so they are not serialized as JSON null.
 * @param record - A request body or query.
 * @returns A shallow clone without undefined values.
 */
export function compact<T extends Record<string, unknown>>(
  record: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Collect a repeatable option into an array.
 * @param value - The new value.
 * @param previous - Values so far.
 * @returns The extended list.
 */
export function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Pagination query from Commander opts.
 * @param opts - Command options.
 * @returns `page` and `limit` when present.
 */
export function pageQuery(opts: {
  page?: string;
  limit?: string;
}): Record<string, number | undefined> {
  return {
    page: opts.page !== undefined ? Number(opts.page) : undefined,
    limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
  };
}

/**
 * Add `--page` / `--limit` to a list command.
 * @param command - The command.
 * @returns The same command.
 */
export function addPageOptions(command: Command): Command {
  return command
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Page size", "25");
}
