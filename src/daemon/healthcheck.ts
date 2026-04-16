import { rename } from "node:fs/promises";
import { getLogPath, LOG_MAX_BYTES } from "../constants.ts";
import { isProcessAlive, readPidFile, removePidFile } from "../utils/pid.ts";
import { spawnDaemon } from "./spawn.ts";

export async function runHealthCheck(projectDir: string): Promise<void> {
  const pid = await readPidFile(projectDir);

  if (pid !== null) {
    if (isProcessAlive(pid)) {
      // Daemon is healthy — nothing to do
      return;
    }
    // Stale PID file — clean it up
    await removePidFile(projectDir);
  }

  // Daemon is not running — start it
  await spawnDaemon(projectDir);

  // Rotate daemon.log if it's too large
  await rotateLogIfNeeded(projectDir);
}

export async function rotateLogIfNeeded(projectDir: string): Promise<void> {
  const logPath = getLogPath(projectDir);
  const logFile = Bun.file(logPath);

  if (!(await logFile.exists())) return;

  if (logFile.size > LOG_MAX_BYTES) {
    try {
      await rename(logPath, `${logPath}.1`);
    } catch {
      // Best-effort rotation — don't fail the healthcheck
    }
  }
}

if (import.meta.main) {
  const projectDir = process.argv[2];
  if (!projectDir) {
    console.error("Usage: bun run healthcheck.ts <projectDir>");
    process.exit(1);
  }
  await runHealthCheck(projectDir);
}
