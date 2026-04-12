import { join } from "path";
import { getLogPath, getBotholomewDir } from "../constants.ts";
import { readPidFile, isProcessAlive } from "../utils/pid.ts";
import { logger } from "../utils/logger.ts";

export async function spawnDaemon(projectDir: string): Promise<void> {
  // Check if already running
  const existingPid = await readPidFile(projectDir);
  if (existingPid && isProcessAlive(existingPid)) {
    logger.warn(`Daemon already running (PID ${existingPid})`);
    return;
  }

  // Ensure .botholomew dir exists
  const dotDir = getBotholomewDir(projectDir);
  const dirExists = await Bun.file(join(dotDir, "config.json")).exists();
  if (!dirExists) {
    logger.error(
      "Project not initialized. Run 'botholomew init' first.",
    );
    process.exit(1);
  }

  const logPath = getLogPath(projectDir);
  const logFile = Bun.file(logPath);

  // Find the daemon entry script
  const daemonScript = new URL("./run.ts", import.meta.url).pathname;

  const proc = Bun.spawn(["bun", "run", daemonScript, projectDir], {
    stdio: ["ignore", logFile, logFile],
    env: { ...process.env },
  });

  // Detach the process
  proc.unref();

  logger.success(`Daemon started in background (PID ${proc.pid})`);
  logger.dim(`  Log: ${logPath}`);
}
