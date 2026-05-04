import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { getSchedulesDir, getSchedulesLockDir } from "../constants.ts";
import { uuidv7 } from "../db/uuid.ts";
import {
  acquireLock,
  atomicWrite,
  atomicWriteIfUnchanged,
  LockHeldError,
  readLockHolder,
  readWithMtime,
  releaseLock,
} from "../fs/atomic.ts";
import { logger } from "../utils/logger.ts";
import {
  type Schedule,
  type ScheduleFrontmatter,
  ScheduleFrontmatterSchema,
} from "./schema.ts";

function scheduleFilePath(projectDir: string, id: string): string {
  return join(getSchedulesDir(projectDir), `${id}.md`);
}

function scheduleLockPath(projectDir: string, id: string): string {
  return join(getSchedulesLockDir(projectDir), `${id}.lock`);
}

function serializeSchedule(fm: ScheduleFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

interface ParseOk {
  ok: true;
  schedule: Schedule;
}
interface ParseFail {
  ok: false;
  reason: string;
}

function parseScheduleFile(raw: string, mtimeMs: number): ParseOk | ParseFail {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { ok: false, reason: `frontmatter parse error: ${err}` };
  }
  const result = ScheduleFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      ok: false,
      reason: `frontmatter validation failed: ${result.error.message}`,
    };
  }
  return {
    ok: true,
    schedule: {
      ...result.data,
      mtimeMs,
      body: parsed.content.trim(),
    },
  };
}

export async function listScheduleFiles(projectDir: string): Promise<string[]> {
  const dir = getSchedulesDir(projectDir);
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function getSchedule(
  projectDir: string,
  id: string,
): Promise<Schedule | null> {
  const file = await readWithMtime(scheduleFilePath(projectDir, id));
  if (!file) return null;
  const parsed = parseScheduleFile(file.content, file.mtimeMs);
  if (!parsed.ok) {
    logger.warn(`Schedule ${id} is malformed: ${parsed.reason}`);
    return null;
  }
  return parsed.schedule;
}

export async function listSchedules(
  projectDir: string,
  filters?: { enabled?: boolean; limit?: number; offset?: number },
): Promise<Schedule[]> {
  const ids = await listScheduleFiles(projectDir);
  const out: Schedule[] = [];
  for (const id of ids) {
    const s = await getSchedule(projectDir, id);
    if (!s) continue;
    if (filters?.enabled !== undefined && s.enabled !== filters.enabled)
      continue;
    out.push(s);
  }
  out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? out.length;
  return out.slice(offset, offset + limit);
}

export async function createSchedule(
  projectDir: string,
  params: {
    name: string;
    description?: string;
    frequency: string;
    enabled?: boolean;
  },
): Promise<Schedule> {
  const id = uuidv7();
  const now = new Date().toISOString();
  const fm: ScheduleFrontmatter = {
    id,
    name: params.name,
    description: params.description ?? "",
    frequency: params.frequency,
    enabled: params.enabled ?? true,
    last_run_at: null,
    created_at: now,
    updated_at: now,
  };
  await atomicWrite(
    scheduleFilePath(projectDir, id),
    serializeSchedule(fm, params.description ?? ""),
  );
  const fresh = await getSchedule(projectDir, id);
  if (!fresh) throw new Error(`Failed to read freshly created schedule ${id}`);
  return fresh;
}

export async function updateSchedule(
  projectDir: string,
  id: string,
  updates: Partial<
    Pick<ScheduleFrontmatter, "name" | "description" | "frequency" | "enabled">
  >,
): Promise<Schedule | null> {
  const s = await getSchedule(projectDir, id);
  if (!s) return null;
  const fm: ScheduleFrontmatter = {
    ...s,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  await atomicWriteIfUnchanged(
    scheduleFilePath(projectDir, id),
    serializeSchedule(fm, s.body),
    s.mtimeMs,
  );
  return getSchedule(projectDir, id);
}

export async function deleteSchedule(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await unlink(scheduleFilePath(projectDir, id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  await releaseLock(scheduleLockPath(projectDir, id));
  return true;
}

export async function deleteAllSchedules(projectDir: string): Promise<number> {
  const ids = await listScheduleFiles(projectDir);
  let n = 0;
  for (const id of ids) {
    if (await deleteSchedule(projectDir, id)) n++;
  }
  return n;
}

export interface ClaimOptions {
  /** Minimum gap (seconds) between schedule runs; protects against double-fire. */
  minIntervalSeconds: number;
}

/**
 * Acquire a schedule's lockfile, verify min-interval, and call `fn` with the
 * locked Schedule. The caller mutates last_run_at via `markScheduleRun`
 * before the lock is dropped. If another worker holds the lock or the
 * schedule ran too recently, returns null without calling `fn`.
 */
export async function withScheduleLock<T>(
  projectDir: string,
  id: string,
  workerId: string,
  opts: ClaimOptions,
  fn: (s: Schedule) => Promise<T>,
): Promise<T | null> {
  const s = await getSchedule(projectDir, id);
  if (!s?.enabled) return null;
  if (s.last_run_at) {
    const last = Date.parse(s.last_run_at);
    if (Date.now() - last < opts.minIntervalSeconds * 1000) return null;
  }
  const lockPath = scheduleLockPath(projectDir, id);
  try {
    await acquireLock(lockPath, workerId);
  } catch (err) {
    if (err instanceof LockHeldError) return null;
    throw err;
  }
  try {
    return await fn(s);
  } finally {
    await releaseLock(lockPath);
  }
}

/**
 * Update last_run_at on a schedule. Uses atomic-write-if-unchanged so a
 * concurrent edit aborts the run instead of clobbering it.
 */
export async function markScheduleRun(
  projectDir: string,
  id: string,
): Promise<void> {
  const s = await getSchedule(projectDir, id);
  if (!s) return;
  const fm: ScheduleFrontmatter = {
    ...s,
    last_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await atomicWriteIfUnchanged(
    scheduleFilePath(projectDir, id),
    serializeSchedule(fm, s.body),
    s.mtimeMs,
  );
}

export async function reapOrphanScheduleLocks(
  projectDir: string,
  isWorkerAlive: (workerId: string) => Promise<boolean>,
): Promise<string[]> {
  const dir = getSchedulesLockDir(projectDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const released: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".lock")) continue;
    const id = name.slice(0, -".lock".length);
    const lockPath = join(dir, name);
    const holder = await readLockHolder(lockPath);
    if (!holder) {
      await releaseLock(lockPath);
      released.push(id);
      continue;
    }
    if (!(await isWorkerAlive(holder))) {
      await releaseLock(lockPath);
      released.push(id);
    }
  }
  return released;
}
