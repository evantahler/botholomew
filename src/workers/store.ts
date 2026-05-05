import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getWorkersDir } from "../constants.ts";
import { atomicWrite, readWithMtime } from "../fs/atomic.ts";

export const WORKER_MODES = ["persist", "once"] as const;
export const WORKER_STATUSES = ["running", "stopped", "dead"] as const;

export type WorkerMode = (typeof WORKER_MODES)[number];
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

/**
 * Persistent worker record. One JSON file per worker at
 * `<projectDir>/workers/<id>.json`. Heartbeats rewrite the file
 * atomically (write-to-tmp + rename); the file's existence is the pidfile,
 * `last_heartbeat_at` inside is the liveness signal.
 */
export interface Worker {
  id: string;
  pid: number;
  hostname: string;
  mode: WorkerMode;
  task_id: string | null;
  status: WorkerStatus;
  started_at: string;
  last_heartbeat_at: string;
  stopped_at: string | null;
  log_path: string | null;
}

function workerFilePath(projectDir: string, id: string): string {
  return join(getWorkersDir(projectDir), `${id}.json`);
}

async function readWorker(
  projectDir: string,
  id: string,
): Promise<Worker | null> {
  const file = await readWithMtime(workerFilePath(projectDir, id));
  if (!file) return null;
  try {
    return JSON.parse(file.content) as Worker;
  } catch {
    return null;
  }
}

async function writeWorker(projectDir: string, worker: Worker): Promise<void> {
  await atomicWrite(
    workerFilePath(projectDir, worker.id),
    `${JSON.stringify(worker, null, 2)}\n`,
  );
}

export async function registerWorker(
  projectDir: string,
  params: {
    id: string;
    pid: number;
    hostname: string;
    mode: WorkerMode;
    taskId?: string | null;
    logPath?: string | null;
  },
): Promise<Worker> {
  const now = new Date().toISOString();
  const worker: Worker = {
    id: params.id,
    pid: params.pid,
    hostname: params.hostname,
    mode: params.mode,
    task_id: params.taskId ?? null,
    status: "running",
    started_at: now,
    last_heartbeat_at: now,
    stopped_at: null,
    log_path: params.logPath ?? null,
  };
  await writeWorker(projectDir, worker);
  return worker;
}

/**
 * Update last_heartbeat_at on a running worker. No-op for stopped/dead
 * workers so a misbehaving heartbeat doesn't resurrect a worker the reaper
 * has retired.
 */
export async function heartbeat(projectDir: string, id: string): Promise<void> {
  const worker = await readWorker(projectDir, id);
  if (!worker || worker.status !== "running") return;
  worker.last_heartbeat_at = new Date().toISOString();
  await writeWorker(projectDir, worker);
}

export async function markWorkerStopped(
  projectDir: string,
  id: string,
): Promise<void> {
  const worker = await readWorker(projectDir, id);
  if (!worker || worker.status !== "running") return;
  worker.status = "stopped";
  worker.stopped_at = new Date().toISOString();
  await writeWorker(projectDir, worker);
}

export async function markWorkerDead(
  projectDir: string,
  id: string,
): Promise<void> {
  const worker = await readWorker(projectDir, id);
  if (!worker) return;
  if (worker.status === "stopped") return; // don't overwrite a clean stop
  worker.status = "dead";
  worker.stopped_at = new Date().toISOString();
  await writeWorker(projectDir, worker);
}

/**
 * Walk `workers/`, mark any running worker as dead if its
 * `last_heartbeat_at` is older than `staleAfterSeconds`. Tasks/schedules
 * they held are reclaimed via the lockfile reapers driven by
 * `isWorkerRunning`. Returns the ids that were just marked dead.
 */
export async function reapDeadWorkers(
  projectDir: string,
  staleAfterSeconds: number,
): Promise<string[]> {
  const ids = await listWorkerIds(projectDir);
  const cutoff = Date.now() - staleAfterSeconds * 1000;
  const reaped: string[] = [];
  for (const id of ids) {
    const w = await readWorker(projectDir, id);
    if (!w || w.status !== "running") continue;
    const heartbeatMs = Date.parse(w.last_heartbeat_at);
    if (Number.isFinite(heartbeatMs) && heartbeatMs >= cutoff) continue;
    w.status = "dead";
    w.stopped_at = new Date().toISOString();
    await writeWorker(projectDir, w);
    reaped.push(id);
  }
  return reaped;
}

export async function isWorkerRunning(
  projectDir: string,
  id: string,
): Promise<boolean> {
  const w = await readWorker(projectDir, id);
  return w?.status === "running";
}

/**
 * Delete cleanly-stopped worker JSON files whose `stopped_at` is older
 * than `afterSeconds`. Dead workers are preserved as forensic evidence.
 */
export async function pruneStoppedWorkers(
  projectDir: string,
  afterSeconds: number,
): Promise<string[]> {
  const ids = await listWorkerIds(projectDir);
  const cutoff = Date.now() - afterSeconds * 1000;
  const pruned: string[] = [];
  for (const id of ids) {
    const w = await readWorker(projectDir, id);
    if (!w || w.status !== "stopped" || !w.stopped_at) continue;
    const stoppedMs = Date.parse(w.stopped_at);
    if (Number.isFinite(stoppedMs) && stoppedMs >= cutoff) continue;
    try {
      await unlink(workerFilePath(projectDir, id));
      pruned.push(id);
    } catch {
      // ignore — concurrent delete is fine
    }
  }
  return pruned;
}

export async function listWorkers(
  projectDir: string,
  filters?: {
    status?: WorkerStatus;
    limit?: number;
    offset?: number;
  },
): Promise<Worker[]> {
  const ids = await listWorkerIds(projectDir);
  const out: Worker[] = [];
  for (const id of ids) {
    const w = await readWorker(projectDir, id);
    if (!w) continue;
    if (filters?.status && w.status !== filters.status) continue;
    out.push(w);
  }
  out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? out.length;
  return out.slice(offset, offset + limit);
}

export async function getWorker(
  projectDir: string,
  id: string,
): Promise<Worker | null> {
  return readWorker(projectDir, id);
}

export async function deleteWorker(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await unlink(workerFilePath(projectDir, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function listWorkerIds(projectDir: string): Promise<string[]> {
  const dir = getWorkersDir(projectDir);
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * For tests / doctor: confirm a worker JSON file exists at the expected path.
 */
export async function workerFileExists(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await stat(workerFilePath(projectDir, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
