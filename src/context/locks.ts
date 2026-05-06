import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CONTEXT_DIR, LOCKS_SUBDIR } from "../constants.ts";
import {
  acquireLock,
  LockHeldError,
  readLockHolder,
  releaseLock,
} from "../fs/atomic.ts";

/**
 * Per-path mutex for `context/` mutations. Tasks/schedules already serialize
 * their own writes via O_EXCL lockfiles; this gives the same guarantee for
 * `context_write` / `context_edit` / `context_delete` / `context_mv` so two
 * tools (worker + chat, or two workers on the same path) can't race on
 * read-modify-write or rename ordering.
 *
 * Lockfiles live at `<projectDir>/context/.locks/<sha1(path)>.lock`. We hash
 * the path so the lock filename is bounded-length and slash-free, and so a
 * leading-dot path doesn't accidentally collide with `walk()`'s dotfile skip
 * in `src/context/store.ts`. The `.locks/` dir itself is invisible to
 * `context_list` (walk skips dot-prefixed names at every depth).
 */

// Retries are exponential-ish with jitter. Total worst-case wait is
// ~5 seconds — comfortable for a small herd of concurrent writers (the
// per-path critical section is just a stat + tmp write + rename, on the
// order of 1-10 ms each), and short enough that a stuck holder surfaces
// to the caller instead of hanging an LLM tool call indefinitely.
const ACQUIRE_RETRIES = 32;
const ACQUIRE_BASE_BACKOFF_MS = 10;
const ACQUIRE_MAX_BACKOFF_MS = 200;

export function getContextLocksDir(projectDir: string): string {
  return join(projectDir, CONTEXT_DIR, LOCKS_SUBDIR);
}

export function contextLockPath(
  projectDir: string,
  normalizedPath: string,
): string {
  const hash = createHash("sha1").update(normalizedPath).digest("hex");
  return join(getContextLocksDir(projectDir), `${hash}.lock`);
}

/**
 * Run `fn` while holding the per-path context lock. Retries a few times with
 * a small backoff if another caller has the lock — concurrent context tools
 * are expected to converge, not surface "try again" errors to the LLM.
 *
 * `holderId` is stored in the lockfile body so the reaper (and humans
 * inspecting `context/.locks/`) can identify the owner. Pass the worker id
 * when called from a worker; chat sessions pass `"chat:<sessionId>"` or
 * just `"chat"` — anything stable for the duration of the operation.
 */
export async function withContextLock<T>(
  projectDir: string,
  normalizedPath: string,
  holderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = contextLockPath(projectDir, normalizedPath);
  for (let attempt = 0; ; attempt++) {
    try {
      await acquireLock(lockPath, holderId);
      try {
        return await fn();
      } finally {
        await releaseLock(lockPath);
      }
    } catch (err) {
      if (err instanceof LockHeldError && attempt < ACQUIRE_RETRIES) {
        const exp = Math.min(
          ACQUIRE_MAX_BACKOFF_MS,
          ACQUIRE_BASE_BACKOFF_MS * 2 ** attempt,
        );
        const jittered = exp * (0.5 + Math.random());
        await new Promise((res) => setTimeout(res, jittered));
        continue;
      }
      throw err;
    }
  }
}

/**
 * True if `<projectDir>/context/.locks/<sha1(path)>.lock` currently exists.
 * Used by the reindex orphan-prune to skip paths that a worker is mid-write
 * on — without this guard the prune can drop the search-index rows of a
 * file that's about to land on disk.
 */
export async function isContextPathLocked(
  projectDir: string,
  normalizedPath: string,
): Promise<boolean> {
  try {
    await stat(contextLockPath(projectDir, normalizedPath));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Reaper: walk `context/.locks/`, drop any lockfile whose holder is no
 * longer running per `isHolderAlive`. Mirrors `reapOrphanLocks` in
 * `src/tasks/store.ts` so the worker reaper can clean stale context locks
 * left behind by a crashed worker.
 *
 * `isHolderAlive` receives the raw holder id — the caller decides what
 * counts as alive (typically: workers/<id>.json status === "running").
 * Holders that don't match the worker convention (e.g. `"chat"` from a
 * chat session) are conservatively treated as alive — not our business
 * to expire those.
 */
export async function reapOrphanContextLocks(
  projectDir: string,
  isHolderAlive: (holderId: string) => Promise<boolean>,
): Promise<string[]> {
  const dir = getContextLocksDir(projectDir);
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
    const lockPath = join(dir, name);
    const holder = await readLockHolder(lockPath);
    if (!holder) {
      await releaseLock(lockPath);
      released.push(name);
      continue;
    }
    if (!(await isHolderAlive(holder))) {
      await releaseLock(lockPath);
      released.push(name);
    }
  }
  return released;
}
