import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "../config/loader.ts";
import { resolveModel } from "../config/models.ts";
import { getConfigPath, getWorkerLogPath } from "../constants.ts";
import { IS_COMPILED_BINARY } from "../runtime.ts";
import { logger } from "../utils/logger.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { dateForId } from "../utils/v7-date.ts";
import type { WorkerMode } from "./index.ts";
import { WORKER_RUN_SENTINEL } from "./sentinel.ts";

export interface SpawnWorkerOptions {
  mode?: WorkerMode;
  taskId?: string;
  /** Propagate `--unsafe` to the detached worker (bypass the approval gate). */
  unsafe?: boolean;
  /** Propagate `--model <name>` to the detached worker. Validated here, in the parent. */
  modelName?: string;
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
  // Validate the model name here, in the parent. A detached worker's errors
  // go to its log file, so a typo'd `--model` would otherwise look like a
  // silent no-op on the terminal.
  if (options.modelName) {
    resolveModel(await loadConfig(projectDir), options.modelName);
  }

  await mkdir(dirname(logPath), { recursive: true });
  const logFile = Bun.file(logPath);

  // In a compiled binary there is no `run.ts` on disk to `bun run`, so re-exec
  // this binary with the sentinel arg that cli.ts intercepts. Under Bun (dev /
  // global install) spawn the worker entry directly.
  const args = IS_COMPILED_BINARY
    ? [process.execPath, WORKER_RUN_SENTINEL, projectDir]
    : ["bun", "run", new URL("./run.ts", import.meta.url).pathname, projectDir];
  args.push(`--worker-id=${workerId}`, `--log-path=${logPath}`);
  if (options.mode === "persist") args.push("--persist");
  if (options.taskId) args.push(`--task-id=${options.taskId}`);
  if (options.unsafe) args.push("--unsafe");
  if (options.modelName) args.push(`--model=${options.modelName}`);

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
