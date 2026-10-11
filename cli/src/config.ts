import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default API origin when no flag, env, or config file names one. */
export const DEFAULT_BASE_URL = "https://api.botholomew.com";

/** Persisted CLI configuration. The session cookie is a secret. */
export interface CliConfigFile {
  /** API origin, without `/api`. */
  baseUrl?: string;
  /** Value of the `__session` cookie. */
  sessionCookie?: string;
  /** Last selected project id or slug. */
  project?: string;
}

/**
 * Directory that holds `config.json`.
 *
 * `$XDG_CONFIG_HOME/botholomew` when set, otherwise `~/.config/botholomew`. Tests
 * point `XDG_CONFIG_HOME` at a temp dir so they never touch the operator's
 * home.
 * @returns The directory path.
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "botholomew");
}

/**
 * Path of the config file.
 * @returns Absolute path to `config.json`.
 */
export function configPath(): string {
  return join(configDir(), "config.json");
}

/**
 * Read the config file, or an empty object when it does not exist.
 * @returns The parsed config.
 */
export function readConfig(): CliConfigFile {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CliConfigFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the config file with mode `0600` so the session cookie is not group-readable.
 * @param config - The full config to persist.
 */
export function writeConfig(config: CliConfigFile): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

/**
 * Resolve the API origin.
 *
 * Highest wins: `--url`, `BOTHOLOMEW_URL` / `BOTHOLOMEW_BASE_URL`, config `baseUrl`,
 * then {@link DEFAULT_BASE_URL}.
 * @param flagUrl - The `--url` flag, if passed.
 * @param file - The on-disk config.
 * @param env - Process environment.
 * @returns Origin without a trailing slash.
 */
export function resolveBaseUrl(
  flagUrl: string | undefined,
  file: CliConfigFile,
  env: NodeJS.Dict<string> = process.env,
): string {
  const raw =
    flagUrl ||
    env.BOTHOLOMEW_URL ||
    env.BOTHOLOMEW_BASE_URL ||
    file.baseUrl ||
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Join an API origin to the `/api` prefix. Callers pass the origin, never `/api`.
 * @param origin - Base URL.
 * @returns `{origin}/api`.
 */
export function apiRoot(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api`;
}

/**
 * Resolve the selected project id or slug.
 * @param flagProject - The `--project` flag.
 * @param file - The on-disk config.
 * @param env - Process environment.
 * @returns The selector, or undefined.
 */
export function resolveProject(
  flagProject: string | undefined,
  file: CliConfigFile,
  env: NodeJS.Dict<string> = process.env,
): string | undefined {
  const raw = flagProject || env.BOTHOLOMEW_PROJECT || file.project;
  return raw && raw.length > 0 ? raw : undefined;
}
