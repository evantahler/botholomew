import { join } from "node:path";

export const BOTHOLOMEW_DIR = ".botholomew";
export const DB_FILENAME = "data.sqlite";
export const PID_FILENAME = "daemon.pid";
export const LOG_FILENAME = "daemon.log";
export const CONFIG_FILENAME = "config.json";
export const MCPX_DIR = "mcpx";
export const MCPX_SERVERS_FILENAME = "servers.json";

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
