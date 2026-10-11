import type { Command } from "commander";
import {
  type CliConfigFile,
  readConfig,
  resolveBaseUrl,
  resolveProject,
} from "./config.ts";

/** Resolved options for one CLI invocation. */
export interface CliContext {
  /** API origin. */
  url: string;
  /** Machine-readable output. */
  json: boolean;
  /** Colorize stdout/stderr. */
  color: boolean;
  /** Selected project id or slug. */
  project?: string;
  /** On-disk config. */
  config: CliConfigFile;
  /** Session cookie, if logged in. */
  sessionCookie?: string;
}

/**
 * Build a {@link CliContext} from Commander globals plus the config file.
 * @param command - The command whose globals to read.
 * @returns The context.
 */
export function contextFromCommand(command: Command): CliContext {
  const opts = command.optsWithGlobals() as {
    url?: string;
    json?: boolean;
    color?: boolean;
    project?: string;
  };
  const file = readConfig();
  const noColorEnv =
    process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
  const json = Boolean(opts.json);
  return {
    url: resolveBaseUrl(opts.url, file),
    json,
    color: opts.color !== false && !noColorEnv && !json,
    project: resolveProject(opts.project, file),
    config: file,
    sessionCookie: file.sessionCookie,
  };
}

/**
 * Require a session cookie.
 * @param ctx - CLI context.
 * @returns The cookie.
 */
export function requireSession(ctx: CliContext): string {
  if (!ctx.sessionCookie) {
    throw new Error("Not signed in. Run `botholomew login` first.");
  }
  return ctx.sessionCookie;
}

/**
 * Require a project selector.
 * @param ctx - CLI context.
 * @returns The id or slug.
 */
export function requireProject(ctx: CliContext): string {
  if (!ctx.project) {
    throw new Error(
      "Pass --project <id-or-slug> or set BOTHOLOMEW_PROJECT / `botholomew project use`.",
    );
  }
  return ctx.project;
}
