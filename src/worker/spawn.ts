import { join } from "node:path";
import { getBotholomewDir, getLogPath } from "../constants.ts";
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
 */
export async function spawnWorker(
  projectDir: string,
  options: SpawnWorkerOptions = {},
): Promise<{ pid: number }> {
  const dotDir = getBotholomewDir(projectDir);
  const dirExists = await Bun.file(join(dotDir, "config.json")).exists();
  if (!dirExists) {
    logger.error("Project not initialized. Run 'botholomew init' first.");
    process.exit(1);
  }

  const logPath = getLogPath(projectDir);
  const logFile = Bun.file(logPath);

  const workerScript = new URL("./run.ts", import.meta.url).pathname;
  const args = ["bun", "run", workerScript, projectDir];
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

  return { pid: proc.pid ?? 0 };
}
