import { mkdir } from "node:fs/promises";
import {
  getConfigPath,
  getWorkerLogPath,
  getWorkerLogsDir,
} from "../constants.ts";
import { uuidv7 } from "../db/uuid.ts";
import { logger } from "../utils/logger.ts";
import type { WorkerMode } from "./index.ts";

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
  await mkdir(getWorkerLogsDir(projectDir), { recursive: true });
  const logPath = getWorkerLogPath(projectDir, workerId);
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
