import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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

  // In a compiled binary there is no `run.ts` on disk to `bun run`, so re-exec
  // this binary with the sentinel arg that cli.ts intercepts. Under Bun (dev /
  // global install) spawn the worker entry directly.
  const args = IS_COMPILED_BINARY
    ? [process.execPath, WORKER_RUN_SENTINEL, projectDir]
    : ["bun", "run", new URL("./run.ts", import.meta.url).pathname, projectDir];
  args.push(`--worker-id=${workerId}`, `--log-path=${logPath}`);
  if (options.mode === "persist") args.push("--persist");
  if (options.taskId) args.push(`--task-id=${options.taskId}`);

  const proc = Bun.spawn(args, {
    stdio: ["ignore", logFile, logFile],
    env: { ...process.env },
  });
  proc.unref();

  const mode = options.mode ?? "once";
  logger.success(
    `Worker spawned in background (PID ${proc.pid}, mode=${mode}${options.taskId ? `, task=${options.taskId}` : ""})`,
  );
  logger.dim(`  Log: ${logPath}`);

  return { pid: proc.pid ?? 0, workerId, logPath };
}
