import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { getTasksDir, getTasksLockDir } from "../constants.ts";
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
  type Task,
  type TaskFrontmatter,
  TaskFrontmatterSchema,
  type TaskPriority,
  type TaskStatus,
} from "./schema.ts";

function taskFilePath(projectDir: string, id: string): string {
  return join(getTasksDir(projectDir), `${id}.md`);
}

function taskLockPath(projectDir: string, id: string): string {
  return join(getTasksLockDir(projectDir), `${id}.lock`);
}

/**
 * Render a Task to its on-disk markdown form. Frontmatter contains every
 * field; the body is preserved as-is. Trailing newline keeps line count sane.
 */
function serializeTask(fm: TaskFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

interface ParseResult {
  ok: true;
  task: Task;
}
interface ParseFailure {
  ok: false;
  reason: string;
}

function parseTaskFile(
  raw: string,
  mtimeMs: number,
): ParseResult | ParseFailure {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { ok: false, reason: `frontmatter parse error: ${err}` };
  }
  const result = TaskFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      ok: false,
      reason: `frontmatter validation failed: ${result.error.message}`,
    };
  }
  return {
    ok: true,
    task: {
      ...result.data,
      mtimeMs,
      body: parsed.content.trim(),
    },
  };
}

export async function listTaskFiles(projectDir: string): Promise<string[]> {
  const dir = getTasksDir(projectDir);
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function getTask(
  projectDir: string,
  id: string,
): Promise<Task | null> {
  const file = await readWithMtime(taskFilePath(projectDir, id));
  if (!file) return null;
  const parsed = parseTaskFile(file.content, file.mtimeMs);
  if (!parsed.ok) {
    logger.warn(`Task ${id} is malformed: ${parsed.reason}`);
    return null;
  }
  return parsed.task;
}

export async function listTasks(
  projectDir: string,
  filters?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    limit?: number;
    offset?: number;
  },
): Promise<Task[]> {
  const ids = await listTaskFiles(projectDir);
  const tasks: Task[] = [];
  for (const id of ids) {
    const t = await getTask(projectDir, id);
    if (!t) continue;
    if (filters?.status && t.status !== filters.status) continue;
    if (filters?.priority && t.priority !== filters.priority) continue;
    tasks.push(t);
  }
  tasks.sort((a, b) => {
    if (a.created_at !== b.created_at)
      return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? tasks.length;
  return tasks.slice(offset, offset + limit);
}

export class TaskNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Task not found: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircularDependencyError";
  }
}

export async function validateBlockedBy(
  projectDir: string,
  taskId: string,
  blockedBy: string[],
): Promise<void> {
  if (blockedBy.length === 0) return;
  if (blockedBy.includes(taskId)) {
    throw new CircularDependencyError(`task ${taskId} cannot block itself`);
  }
  const visited = new Set<string>();
  const dfs = async (currentId: string): Promise<void> => {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    const t = await getTask(projectDir, currentId);
    if (!t) return;
    for (const dep of t.blocked_by) {
      if (dep === taskId) {
        throw new CircularDependencyError(
          `adding blocked_by would create a cycle involving task ${taskId}`,
        );
      }
      await dfs(dep);
    }
  };
  for (const blockerId of blockedBy) await dfs(blockerId);
}

export async function createTask(
  projectDir: string,
  params: {
    name: string;
    description?: string;
    priority?: TaskPriority;
    blocked_by?: string[];
    context_paths?: string[];
  },
): Promise<Task> {
  const id = uuidv7();
  await validateBlockedBy(projectDir, id, params.blocked_by ?? []);
  const now = new Date().toISOString();
  const fm: TaskFrontmatter = {
    id,
    name: params.name,
    description: params.description ?? "",
    priority: params.priority ?? "medium",
    status: "pending",
    blocked_by: params.blocked_by ?? [],
    context_paths: params.context_paths ?? [],
    output: null,
    waiting_reason: null,
    claimed_by: null,
    claimed_at: null,
    created_at: now,
    updated_at: now,
  };
  const path = taskFilePath(projectDir, id);
  await atomicWrite(path, serializeTask(fm, params.description ?? ""));
  const fresh = await getTask(projectDir, id);
  if (!fresh) throw new Error(`Failed to read freshly created task ${id}`);
  return fresh;
}

export async function updateTask(
  projectDir: string,
  id: string,
  updates: Partial<
    Pick<
      TaskFrontmatter,
      "name" | "description" | "priority" | "blocked_by" | "status"
    >
  >,
): Promise<Task | null> {
  const t = await getTask(projectDir, id);
  if (!t) return null;
  if (updates.blocked_by !== undefined) {
    await validateBlockedBy(projectDir, id, updates.blocked_by);
  }
  const fm: TaskFrontmatter = {
    ...t,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  await atomicWriteIfUnchanged(
    taskFilePath(projectDir, id),
    serializeTask(fm, t.body),
    t.mtimeMs,
  );
  return getTask(projectDir, id);
}

export async function deleteTask(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await unlink(taskFilePath(projectDir, id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  await releaseLock(taskLockPath(projectDir, id));
  return true;
}

export async function deleteAllTasks(projectDir: string): Promise<number> {
  const ids = await listTaskFiles(projectDir);
  let n = 0;
  for (const id of ids) {
    if (await deleteTask(projectDir, id)) n++;
  }
  return n;
}

/**
 * Mark a task complete/failed/waiting and update output / waiting_reason.
 * Atomic-write-if-unchanged so a concurrent vim save doesn't get clobbered.
 */
export async function updateTaskStatus(
  projectDir: string,
  id: string,
  status: TaskStatus,
  reason?: string | null,
  output?: string | null,
): Promise<void> {
  const t = await getTask(projectDir, id);
  if (!t) throw new TaskNotFoundError(id);
  const fm: TaskFrontmatter = {
    ...t,
    status,
    waiting_reason: reason ?? null,
    output: output ?? null,
    claimed_by: status === "in_progress" ? t.claimed_by : null,
    claimed_at: status === "in_progress" ? t.claimed_at : null,
    updated_at: new Date().toISOString(),
  };
  await atomicWriteIfUnchanged(
    taskFilePath(projectDir, id),
    serializeTask(fm, t.body),
    t.mtimeMs,
  );
}

/**
 * Reset tasks whose `claimed_at` is older than `timeoutSeconds` back to
 * pending. Used by the worker tick to recover from crashed claimers whose
 * lockfile was reaped but whose task file still says in_progress.
 */
export async function resetStaleTasks(
  projectDir: string,
  timeoutSeconds: number,
): Promise<string[]> {
  const ids = await listTaskFiles(projectDir);
  const cutoff = Date.now() - timeoutSeconds * 1000;
  const reset: string[] = [];
  for (const id of ids) {
    const t = await getTask(projectDir, id);
    if (!t || t.status !== "in_progress") continue;
    const claimedAt = t.claimed_at ? Date.parse(t.claimed_at) : Date.now();
    if (claimedAt >= cutoff) continue;
    const fm: TaskFrontmatter = {
      ...t,
      status: "pending",
      claimed_by: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    };
    try {
      await atomicWriteIfUnchanged(
        taskFilePath(projectDir, id),
        serializeTask(fm, t.body),
        t.mtimeMs,
      );
      // Best-effort: drop a stale lockfile too, in case it got missed.
      await releaseLock(taskLockPath(projectDir, id));
      reset.push(id);
    } catch {
      // Concurrent write — try again next tick.
    }
  }
  return reset;
}

/**
 * Attempt to claim the highest-priority unblocked pending task by acquiring
 * its lockfile via O_EXCL. Returns the claimed task on success, null if no
 * eligible task is available or every candidate is contended.
 *
 * On success, the task's frontmatter is updated to status=in_progress,
 * claimed_by=workerId, claimed_at=now via atomic-write-if-unchanged. The
 * caller releases the lock by calling `releaseTaskLock(id)` after writing
 * the terminal status.
 */
export async function claimNextTask(
  projectDir: string,
  workerId: string,
): Promise<Task | null> {
  const all = await listTasks(projectDir, { status: "pending" });
  // Highest priority first, then oldest first.
  all.sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return a.created_at < b.created_at ? -1 : 1;
  });

  for (const candidate of all) {
    if (!(await isUnblocked(projectDir, candidate))) continue;
    const claimed = await tryClaim(projectDir, candidate.id, workerId);
    if (claimed) return claimed;
  }
  return null;
}

export async function claimSpecificTask(
  projectDir: string,
  id: string,
  workerId: string,
): Promise<Task | null> {
  const t = await getTask(projectDir, id);
  if (!t || t.status !== "pending") return null;
  return tryClaim(projectDir, id, workerId);
}

async function tryClaim(
  projectDir: string,
  id: string,
  workerId: string,
): Promise<Task | null> {
  const lockPath = taskLockPath(projectDir, id);
  try {
    await acquireLock(lockPath, workerId);
  } catch (err) {
    if (err instanceof LockHeldError) return null;
    throw err;
  }
  try {
    const t = await getTask(projectDir, id);
    if (!t || t.status !== "pending") {
      await releaseLock(lockPath);
      return null;
    }
    const now = new Date().toISOString();
    const fm: TaskFrontmatter = {
      ...t,
      status: "in_progress",
      claimed_by: workerId,
      claimed_at: now,
      updated_at: now,
    };
    try {
      await atomicWriteIfUnchanged(
        taskFilePath(projectDir, id),
        serializeTask(fm, t.body),
        t.mtimeMs,
      );
    } catch (err) {
      await releaseLock(lockPath);
      throw err;
    }
    return getTask(projectDir, id);
  } catch (err) {
    await releaseLock(lockPath);
    throw err;
  }
}

export async function releaseTaskLock(
  projectDir: string,
  id: string,
): Promise<void> {
  await releaseLock(taskLockPath(projectDir, id));
}

function priorityRank(p: TaskPriority): number {
  return p === "high" ? 0 : p === "medium" ? 1 : 2;
}

async function isUnblocked(projectDir: string, t: Task): Promise<boolean> {
  if (t.blocked_by.length === 0) return true;
  for (const blockerId of t.blocked_by) {
    const blocker = await getTask(projectDir, blockerId);
    if (!blocker || blocker.status !== "complete") return false;
  }
  return true;
}

/**
 * Reaper: walk tasks/.locks/, for each lock determine the holder; if that
 * worker is dead/missing per `isWorkerAlive`, drop the lock so the next
 * tick can re-claim. Returns the released lock-task ids.
 */
export async function reapOrphanLocks(
  projectDir: string,
  isWorkerAlive: (workerId: string) => Promise<boolean>,
): Promise<string[]> {
  const dir = getTasksLockDir(projectDir);
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

/**
 * Probe lockfile mtime to confirm a file exists. Used by the worker's main
 * loop to confirm its claim is still held by us before writing terminal status.
 */
export async function lockExists(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await stat(taskLockPath(projectDir, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
