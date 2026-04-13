import { unlink } from "node:fs/promises";
import { getPidPath } from "../constants.ts";

export function writePidFile(projectDir: string, pid: number): void {
  Bun.write(getPidPath(projectDir), String(pid));
}

export async function readPidFile(projectDir: string): Promise<number | null> {
  const file = Bun.file(getPidPath(projectDir));
  if (!(await file.exists())) return null;
  const text = await file.text();
  const pid = parseInt(text.trim(), 10);
  return Number.isNaN(pid) ? null : pid;
}

export async function removePidFile(projectDir: string): Promise<void> {
  try {
    await unlink(getPidPath(projectDir));
  } catch {
    // ignore if file doesn't exist
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getDaemonStatus(
  projectDir: string,
): Promise<{ pid: number } | null> {
  const pid = await readPidFile(projectDir);
  if (pid === null) return null;
  if (!isProcessAlive(pid)) {
    await removePidFile(projectDir);
    return null;
  }
  return { pid };
}

export async function stopDaemon(projectDir: string): Promise<boolean> {
  const pid = await readPidFile(projectDir);
  if (pid === null) return false;
  if (!isProcessAlive(pid)) {
    await removePidFile(projectDir);
    return false;
  }
  process.kill(pid, "SIGTERM");
  await removePidFile(projectDir);
  return true;
}
