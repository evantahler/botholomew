import { homedir } from "node:os";
import { join } from "node:path";

export const BOTHOLOMEW_DIR = ".botholomew";
export const HOME_CONFIG_DIR = join(homedir(), ".botholomew");

export const ENV = {
  NO_UPDATE_CHECK: "BOTHOLOMEW_NO_UPDATE_CHECK",
} as const;

export const DEFAULTS = {
  UPDATE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
  UPDATE_CHECK_TIMEOUT_MS: 5_000,
} as const;
export const DB_FILENAME = "data.duckdb";
export const PID_FILENAME = "daemon.pid";
export const LOG_FILENAME = "daemon.log";
export const CONFIG_FILENAME = "config.json";
export const MCPX_DIR = "mcpx";
export const SKILLS_DIR = "skills";
export const MCPX_SERVERS_FILENAME = "servers.json";
export const EMBEDDING_DIMENSION = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export const LAUNCHD_LABEL_PREFIX = "com.botholomew.";
export const SYSTEMD_UNIT_PREFIX = "botholomew-";
export const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const WATCHDOG_LOG_FILENAME = "watchdog.log";

export function getBotholomewDir(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR);
}

export function getDbPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, DB_FILENAME);
}

export function getPidPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, PID_FILENAME);
}

export function getLogPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, LOG_FILENAME);
}

export function getConfigPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, CONFIG_FILENAME);
}

export function getMcpxDir(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, MCPX_DIR);
}

export function getSkillsDir(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, SKILLS_DIR);
}

export function getWatchdogLogPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, WATCHDOG_LOG_FILENAME);
}

/**
 * Convert an absolute directory path into a service-name-safe string.
 * e.g. "/Users/evan/myproject" → "users-evan-myproject"
 */
export function sanitizePathForServiceName(projectDir: string): string {
  return projectDir
    .toLowerCase()
    .replace(/[/\\:]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-+/g, "-");
}
