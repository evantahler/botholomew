import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Project layout (rooted at `projectDir`, typically the user's cwd):
 *
 *   <projectDir>/
 *     config/config.json
 *     persistent-context/{soul,beliefs,goals,capabilities}.md
 *     skills/*.md
 *     mcpx/servers.json
 *     models/                    embedding model cache
 *     context/                   agent-writable file tree
 *     tasks/<id>.md              tasks (status in frontmatter)
 *     tasks/.locks/<id>.lock     O_EXCL claim files
 *     schedules/<id>.md          schedules
 *     schedules/.locks/<id>.lock
 *     logs/                      worker logs
 *     .botholomew-index.duckdb   search index (rebuildable from disk)
 */

export const HOME_CONFIG_DIR = join(homedir(), ".botholomew");

export const ENV = {
  NO_UPDATE_CHECK: "BOTHOLOMEW_NO_UPDATE_CHECK",
} as const;

export const DEFAULTS = {
  UPDATE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
  UPDATE_CHECK_TIMEOUT_MS: 5_000,
} as const;

export const INDEX_DB_FILENAME = ".botholomew-index.duckdb";
export const CONFIG_DIR = "config";
export const CONFIG_FILENAME = "config.json";
export const PERSISTENT_CONTEXT_DIR = "persistent-context";
export const SKILLS_DIR = "skills";
export const MCPX_DIR = "mcpx";
export const MODELS_DIR = "models";
export const CONTEXT_DIR = "context";
export const TASKS_DIR = "tasks";
export const SCHEDULES_DIR = "schedules";
export const LOCKS_SUBDIR = ".locks";
export const LOGS_DIR = "logs";
export const MCPX_SERVERS_FILENAME = "servers.json";
export const EMBEDDING_DIMENSION = 384;
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

/**
 * Top-level areas tools must never touch directly. Use as a safelist when
 * validating tool path arguments — most file/dir tools pin to CONTEXT_DIR.
 */
export const PROTECTED_AREAS: ReadonlySet<string> = new Set([
  MODELS_DIR,
  LOGS_DIR,
  TASKS_DIR + "/" + LOCKS_SUBDIR,
  SCHEDULES_DIR + "/" + LOCKS_SUBDIR,
]);

export function getDbPath(projectDir: string): string {
  return join(projectDir, INDEX_DB_FILENAME);
}

export function getWorkerLogsDir(projectDir: string): string {
  return join(projectDir, LOGS_DIR);
}

export function getWorkerLogPath(projectDir: string, workerId: string): string {
  return join(projectDir, LOGS_DIR, `${workerId}.log`);
}

export function getConfigPath(projectDir: string): string {
  return join(projectDir, CONFIG_DIR, CONFIG_FILENAME);
}

export function getMcpxDir(projectDir: string): string {
  return join(projectDir, MCPX_DIR);
}

export function getModelsDir(projectDir: string): string {
  return (
    process.env.BOTHOLOMEW_MODELS_DIR_OVERRIDE ?? join(projectDir, MODELS_DIR)
  );
}

export function getSkillsDir(projectDir: string): string {
  return join(projectDir, SKILLS_DIR);
}

export function getPersistentContextDir(projectDir: string): string {
  return join(projectDir, PERSISTENT_CONTEXT_DIR);
}

export function getContextDir(projectDir: string): string {
  return join(projectDir, CONTEXT_DIR);
}

export function getTasksDir(projectDir: string): string {
  return join(projectDir, TASKS_DIR);
}

export function getTasksLockDir(projectDir: string): string {
  return join(projectDir, TASKS_DIR, LOCKS_SUBDIR);
}

export function getSchedulesDir(projectDir: string): string {
  return join(projectDir, SCHEDULES_DIR);
}

export function getSchedulesLockDir(projectDir: string): string {
  return join(projectDir, SCHEDULES_DIR, LOCKS_SUBDIR);
}
