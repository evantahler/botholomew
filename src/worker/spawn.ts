import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getConfigPath, getWorkerLogPath } from "../constants.ts";
import { logger } from "../utils/logger.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { dateForId } from "../utils/v7-date.ts";
import type { WorkerMode } from "./index.ts";

export interface SpawnWorkerOptions {
  mode?: WorkerMode;
  taskId?: string;
}

/**
 * Env for a detached worker whose stdout/stderr is a log file: force no ANSI
 * color. `ansis` (and other color libs) read these vars at import time, and
 * `FORCE_COLOR` overrides `NO_COLOR`, so we must remove the forcing vars in
 * addition to setting `NO_COLOR`. Without this, an interactive shell's inherited
 * `FORCE_COLOR`/`COLORTERM` would make ansis emit escape codes into the log file
 * even though the child's stdout is a file, not a TTY.
 */
export function colorlessEnv(
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  env.NO_COLOR = "1";
  delete env.FORCE_COLOR;
  delete env.CLICOLOR_FORCE;
  return env;
}

/**
 * Spawn a worker as a detached background process. Unlike the old daemon
 * model, multiple workers per project are allowed and expected — this just
 * launches a new one.
 *
 * The parent generates the worker id and opens a per-worker log file before
 * spawning so that the TUI / CLI can later tail just this worker's output.
 */
export async function spawnWorker(
  projectDir: string,
  options: SpawnWorkerOptions = {},
): Promise<{ pid: number; workerId: string; logPath: string }> {
  const configPath = getConfigPath(projectDir);
  const initialized = await Bun.file(configPath).exists();
  if (!initialized) {
    logger.error("Project not initialized. Run 'botholomew init' first.");
    process.exit(1);
  }

  const workerId = uuidv7();
  // Per-worker log path is derived from the worker id's UTC date so the
  // logs/ tree stays browsable as workers accumulate. Mirrors the threads
  // layout under <projectDir>/threads/.
  const logPath = getWorkerLogPath(projectDir, workerId, dateForId(workerId));
  await mkdir(dirname(logPath), { recursive: true });
  const logFile = Bun.file(logPath);

  const workerScript = new URL("./run.ts", import.meta.url).pathname;
  const args = [
    "bun",
    "run",
    workerScript,
    projectDir,
    `--worker-id=${workerId}`,
    `--log-path=${logPath}`,
  ];
  if (options.mode === "persist") args.push("--persist");
  if (options.taskId) args.push(`--task-id=${options.taskId}`);

  const proc = Bun.spawn(args, {
    stdio: ["ignore", logFile, logFile],
    env: colorlessEnv(),
  });
  proc.unref();

  const mode = options.mode ?? "once";
  logger.success(
    `Worker spawned in background (PID ${proc.pid}, mode=${mode}${options.taskId ? `, task=${options.taskId}` : ""})`,
  );
  logger.dim(`  Log: ${logPath}`);

  return { pid: proc.pid ?? 0, workerId, logPath };
}
