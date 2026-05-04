import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Write `content` to `targetPath` atomically: write to a sibling temp file,
 * fsync, then rename. The rename is atomic on POSIX same-filesystem; the
 * fsync ensures the file's bytes are durable before the rename commits.
 *
 * `tempSuffix` may be set to ensure two writers don't collide on a temp
 * filename in the same directory (use the worker id for status updates).
 */
export async function atomicWrite(
  targetPath: string,
  content: string | Uint8Array,
  opts: { tempSuffix?: string } = {},
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const suffix = opts.tempSuffix ?? `${process.pid}.${Date.now()}`;
  const tmp = `${targetPath}.tmp.${suffix}`;
  const fh = await open(tmp, "w", 0o644);
  try {
    if (typeof content === "string") {
      await fh.writeFile(content, "utf-8");
    } else {
      await fh.writeFile(content);
    }
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, targetPath);
}

/**
 * Read a file's contents along with its mtime in a single call so callers can
 * detect concurrent modification before committing an update. Returns null if
 * the file doesn't exist.
 */
export async function readWithMtime(
  path: string,
): Promise<{ content: string; mtimeMs: number } | null> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const content = await readFile(path, "utf-8");
  return { content, mtimeMs: st.mtimeMs };
}

export class MtimeConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expectedMtimeMs: number,
    readonly actualMtimeMs: number,
  ) {
    super(
      `concurrent modification detected for ${path}: expected mtime ${expectedMtimeMs}, found ${actualMtimeMs}`,
    );
    this.name = "MtimeConflictError";
  }
}

/**
 * Atomic write guarded by mtime. Re-stats the target right before the rename
 * commit; if it has changed since `expectedMtimeMs`, throws MtimeConflictError
 * without touching the file. Use for read-modify-write of user-editable files
 * (tasks, schedules) so a concurrent vim save doesn't get clobbered.
 */
export async function atomicWriteIfUnchanged(
  targetPath: string,
  content: string,
  expectedMtimeMs: number,
  opts: { tempSuffix?: string } = {},
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const suffix = opts.tempSuffix ?? `${process.pid}.${Date.now()}`;
  const tmp = `${targetPath}.tmp.${suffix}`;
  const fh = await open(tmp, "w", 0o644);
  try {
    await fh.writeFile(content, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    const st = await stat(targetPath);
    if (st.mtimeMs !== expectedMtimeMs) {
      await unlink(tmp).catch(() => {});
      throw new MtimeConflictError(targetPath, expectedMtimeMs, st.mtimeMs);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }
  await rename(tmp, targetPath);
}

export class LockHeldError extends Error {
  constructor(
    readonly lockPath: string,
    readonly heldBy: string | null,
  ) {
    super(`lock ${lockPath} is held${heldBy ? ` by ${heldBy}` : ""}`);
    this.name = "LockHeldError";
  }
}

/**
 * Acquire an exclusive lock by creating a sentinel file with O_EXCL. Returns
 * the path to the lockfile (release with releaseLock). If another worker
 * already holds the lock, throws LockHeldError including the holder's id.
 *
 * The lockfile body is JSON containing the workerId and acquired_at, useful
 * for the reaper to identify dead-worker locks.
 */
export async function acquireLock(
  lockPath: string,
  workerId: string,
): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  const body = JSON.stringify({
    worker_id: workerId,
    acquired_at: new Date().toISOString(),
    pid: process.pid,
  });
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(
      lockPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o644,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const heldBy = await readLockHolder(lockPath);
      throw new LockHeldError(lockPath, heldBy);
    }
    throw err;
  }
  try {
    await fh.writeFile(body, "utf-8");
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export async function readLockHolder(lockPath: string): Promise<string | null> {
  try {
    const text = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(text);
    return typeof parsed.worker_id === "string" ? parsed.worker_id : null;
  } catch {
    return null;
  }
}

export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Run `fn` while holding a lock. Releases the lock even if `fn` throws.
 * Throws LockHeldError if the lock can't be acquired immediately.
 */
export async function withLock<T>(
  lockPath: string,
  workerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireLock(lockPath, workerId);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}

/**
 * Recursively remove a directory if it exists. Used by init --force.
 */
export async function rmrf(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * Build an absolute path without going through the sandbox helper. Useful
 * for internal (non-user-supplied) paths derived from constants.
 */
export function joinSafe(...parts: string[]): string {
  return join(...parts);
}
