import { getDaemonStatus } from "../utils/pid.ts";
import { spawnDaemon } from "./spawn.ts";

/**
 * If no daemon is running for this project, spawn one in the background.
 * Returns true if a new daemon was spawned, false if one was already running.
 */
export async function ensureDaemonRunning(
  projectDir: string,
): Promise<boolean> {
  const status = await getDaemonStatus(projectDir);
  if (status) return false;

  await spawnDaemon(projectDir);
  return true;
}
