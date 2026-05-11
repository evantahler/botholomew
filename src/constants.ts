import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Project layout (rooted at `projectDir`, typically the user's cwd):
 *
 *   <projectDir>/
 *     config/config.json
 *     config.json                       membot config (separate from ours)
 *     index.duckdb                      membot-owned knowledge store
 *     prompts/*.md                      init seeds goals/beliefs/capabilities
 *     skills/*.md
 *     mcpx/servers.json
 *     tasks/<id>.md                     tasks (status in frontmatter)
 *     tasks/.locks/<id>.lock            O_EXCL claim files
 *     schedules/<id>.md
 *     schedules/.locks/<id>.lock
 *     threads/<YYYY-MM-DD>/<id>.csv     conversation history
 *     workers/<id>.json                 pidfile + heartbeat
 *     logs/                             worker logs
 *
 * The agent's knowledge ("what used to be `context/`") now lives in
 * `index.duckdb`, managed by the `membot` library. Tasks, schedules, threads,
 * workers, prompts, and skills remain real files on disk.
 */

export const HOME_CONFIG_DIR = join(homedir(), ".botholomew");

export const ENV = {
  NO_UPDATE_CHECK: "BOTHOLOMEW_NO_UPDATE_CHECK",
} as const;

export const DEFAULTS = {
  UPDATE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
  UPDATE_CHECK_TIMEOUT_MS: 5_000,
} as const;

export const CONFIG_DIR = "config";
export const CONFIG_FILENAME = "config.json";
export const PROMPTS_DIR = "prompts";
export const SKILLS_DIR = "skills";
export const MCPX_DIR = "mcpx";
export const TASKS_DIR = "tasks";
export const SCHEDULES_DIR = "schedules";
export const LOCKS_SUBDIR = ".locks";
export const LOGS_DIR = "logs";
export const WORKERS_DIR = "workers";
export const THREADS_DIR = "threads";
export const MCPX_SERVERS_FILENAME = "servers.json";

/**
 * Top-level areas tools must never touch directly. Tasks/schedule lockfile
 * dirs are kept off-limits because their `O_EXCL` claim semantics break if
 * something else writes into them.
 */
export const PROTECTED_AREAS: ReadonlySet<string> = new Set([
  LOGS_DIR,
  `${TASKS_DIR}/${LOCKS_SUBDIR}`,
  `${SCHEDULES_DIR}/${LOCKS_SUBDIR}`,
]);

export function getWorkerLogsDir(projectDir: string): string {
  return join(projectDir, LOGS_DIR);
}

/**
 * Per-worker log file at `<logs>/<YYYY-MM-DD>/<workerId>.log`. The date
 * subdir keeps the logs directory browsable as workers accumulate.
 * Callers derive `date` from the worker's uuidv7 timestamp via
 * `src/utils/v7-date.ts::dateForId` so the path is a pure function of
 * the id and survives a process restart.
 */
export function getWorkerLogPath(
  projectDir: string,
  workerId: string,
  date: string,
): string {
  return join(projectDir, LOGS_DIR, date, `${workerId}.log`);
}

export function getConfigPath(projectDir: string): string {
  return join(projectDir, CONFIG_DIR, CONFIG_FILENAME);
}

export function getMcpxDir(projectDir: string): string {
  return join(projectDir, MCPX_DIR);
}

export function getSkillsDir(projectDir: string): string {
  return join(projectDir, SKILLS_DIR);
}

export function getPromptsDir(projectDir: string): string {
  return join(projectDir, PROMPTS_DIR);
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

export function getWorkersDir(projectDir: string): string {
  return join(projectDir, WORKERS_DIR);
}

export function getThreadsDir(projectDir: string): string {
  return join(projectDir, THREADS_DIR);
}
