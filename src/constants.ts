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
export const LOGS_DIR = "logs";
export const CONFIG_FILENAME = "config.json";
export const MCPX_DIR = "mcpx";
export const SKILLS_DIR = "skills";
export const MCPX_SERVERS_FILENAME = "servers.json";
export const EMBEDDING_DIMENSION = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export function getBotholomewDir(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR);
}

export function getDbPath(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, DB_FILENAME);
}

export function getWorkerLogsDir(projectDir: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, LOGS_DIR);
}

export function getWorkerLogPath(projectDir: string, workerId: string): string {
  return join(projectDir, BOTHOLOMEW_DIR, LOGS_DIR, `${workerId}.log`);
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
