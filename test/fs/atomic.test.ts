/**
 * Tests for the on-disk concurrency primitives in src/fs/atomic.ts:
 * atomicWrite, atomicWriteIfUnchanged, acquireLock/releaseLock/withLock,
 * readLockHolder, readWithMtime. These primitives back tasks/schedules
 * claim and the worker pidfile, so a regression here is a regression in
 * concurrent worker safety.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  atomicWrite,
  atomicWriteIfUnchanged,
  LockHeldError,
  MtimeConflictError,
  readLockHolder,
  readWithMtime,
  releaseLock,
  withLock,
} from "../../src/fs/atomic.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "both-atomic-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  test("writes content to a new file", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "hello");
    expect(await readFile(path, "utf-8")).toBe("hello");
  });

  test("creates intermediate directories", async () => {
    const path = join(dir, "a/b/c/x.md");
    await atomicWrite(path, "deep");
    expect(await readFile(path, "utf-8")).toBe("deep");
  });

  test("overwrites an existing file in one rename", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "v1");
    await atomicWrite(path, "v2");
    expect(await readFile(path, "utf-8")).toBe("v2");
  });

  test("supports a Uint8Array payload", async () => {
    const path = join(dir, "binary");
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    await atomicWrite(path, bytes);
    const back = await readFile(path);
    expect(Array.from(back)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  test("temp files do not linger after a successful write", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "ok");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.startsWith("x.md.tmp"))).toEqual([]);
  });

  test("16 concurrent writes to the same target — every write resolves and the file holds one of the values", async () => {
    // Regression for a bug where the default temp suffix (`pid.timeMs`)
    // collided when two callers in the same process wrote in the same
    // millisecond — both would open and overwrite the same temp file, then
    // the second rename() would fail with ENOENT.
    const path = join(dir, "race.md");
    const writes = Array.from({ length: 16 }, (_, i) =>
      atomicWrite(path, `value-${i}`),
    );
    const results = await Promise.allSettled(writes);
    for (const r of results) {
      if (r.status === "rejected") throw r.reason;
    }
    const final = await readFile(path, "utf-8");
    expect(final).toMatch(/^value-\d+$/);
    const { readdir } = await import("node:fs/promises");
    const tmps = (await readdir(dir)).filter((e) =>
      e.startsWith("race.md.tmp"),
    );
    expect(tmps).toEqual([]);
  });

  test("explicit tempSuffix collision is surfaced (O_EXCL — not silently overwritten)", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "a", { tempSuffix: "fixed" });
    // First call already finished and renamed the temp file away, so a
    // second call with the same suffix should succeed (the tmp slot is free).
    await atomicWrite(path, "b", { tempSuffix: "fixed" });
    expect(await readFile(path, "utf-8")).toBe("b");

    // But two parallel writes that both compute the same fixed suffix MUST
    // not silently coexist on the same temp file. One should error rather
    // than letting the second writer truncate the first.
    const racing = await Promise.allSettled([
      atomicWrite(path, "p", { tempSuffix: "race" }),
      atomicWrite(path, "q", { tempSuffix: "race" }),
    ]);
    const oks = racing.filter((r) => r.status === "fulfilled");
    const errs = racing.filter((r) => r.status === "rejected");
    expect(oks.length + errs.length).toBe(2);
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("readWithMtime", () => {
  test("returns null for missing files", async () => {
    expect(await readWithMtime(join(dir, "no.md"))).toBeNull();
  });

  test("returns content + mtime for existing files", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "hello");
    const r = await readWithMtime(path);
    expect(r?.content).toBe("hello");
    expect(r?.mtimeMs).toBeGreaterThan(0);
    const st = await stat(path);
    expect(r?.mtimeMs).toBe(st.mtimeMs);
  });
});

describe("atomicWriteIfUnchanged", () => {
  test("commits when the file's mtime still matches", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "v1");
    const r = await readWithMtime(path);
    if (!r) throw new Error("missing");
    await atomicWriteIfUnchanged(path, "v2", r.mtimeMs);
    expect(await readFile(path, "utf-8")).toBe("v2");
  });

  test("throws MtimeConflictError when the file was modified mid-flight", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "v1");
    const r = await readWithMtime(path);
    if (!r) throw new Error("missing");

    // Sleep so the OS will register a different mtime; some filesystems have
    // 1ms or coarser mtime resolution.
    await new Promise((res) => setTimeout(res, 20));
    await atomicWrite(path, "racy-update");

    await expect(
      atomicWriteIfUnchanged(path, "v2", r.mtimeMs),
    ).rejects.toBeInstanceOf(MtimeConflictError);

    // The racy write is still on disk; we did NOT clobber it.
    expect(await readFile(path, "utf-8")).toBe("racy-update");
  });

  test("refuses to resurrect a deleted file (ENOENT is a conflict)", async () => {
    // Real callers always pass a non-zero mtime read from the file before
    // their update; a missing target between read and write means another
    // writer (e.g. deleteTask) ran in the gap. Resurrecting it would make
    // delete-vs-update lose silently.
    const path = join(dir, "ghost.md");
    await expect(
      atomicWriteIfUnchanged(path, "should-not-stick", /*expected mtime*/ 100),
    ).rejects.toBeInstanceOf(MtimeConflictError);
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("does not leave a temp file behind after the ENOENT conflict", async () => {
    const path = join(dir, "ghost.md");
    await atomicWriteIfUnchanged(path, "x", 100).catch(() => null);
    const { readdir } = await import("node:fs/promises");
    const tmps = (await readdir(dir)).filter((e) =>
      e.startsWith("ghost.md.tmp"),
    );
    expect(tmps).toEqual([]);
  });

  test("temp file is cleaned up after a conflict", async () => {
    const path = join(dir, "x.md");
    await atomicWrite(path, "v1");
    const r = await readWithMtime(path);
    if (!r) throw new Error("missing");
    await new Promise((res) => setTimeout(res, 20));
    await atomicWrite(path, "racy");

    await atomicWriteIfUnchanged(path, "v2", r.mtimeMs).catch(() => null);

    const { readdir } = await import("node:fs/promises");
    const tmps = (await readdir(dir)).filter((e) => e.startsWith("x.md.tmp"));
    expect(tmps).toEqual([]);
  });
});

describe("acquireLock + releaseLock", () => {
  test("first acquire creates the lockfile with the worker id in it", async () => {
    const lockPath = join(dir, "x.lock");
    await acquireLock(lockPath, "worker-A");
    expect(await readLockHolder(lockPath)).toBe("worker-A");
  });

  test("second acquire on the same path throws LockHeldError naming the holder", async () => {
    const lockPath = join(dir, "x.lock");
    await acquireLock(lockPath, "worker-A");
    try {
      await acquireLock(lockPath, "worker-B");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LockHeldError);
      expect((err as LockHeldError).heldBy).toBe("worker-A");
    }
  });

  test("releaseLock unlinks the lockfile", async () => {
    const lockPath = join(dir, "x.lock");
    await acquireLock(lockPath, "worker-A");
    await releaseLock(lockPath);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("releaseLock on a missing lock is a no-op (idempotent reaping)", async () => {
    await expect(
      releaseLock(join(dir, "no-such.lock")),
    ).resolves.toBeUndefined();
  });

  test("readLockHolder returns null for missing or unparseable lockfiles", async () => {
    expect(await readLockHolder(join(dir, "missing.lock"))).toBeNull();
    const garbage = join(dir, "garbage.lock");
    await atomicWrite(garbage, "{not valid json");
    expect(await readLockHolder(garbage)).toBeNull();
  });
});

describe("acquireLock — concurrency", () => {
  test("16 concurrent acquires on the same lock — exactly one wins", async () => {
    const lockPath = join(dir, "race.lock");
    const attempts = Array.from({ length: 16 }, (_, i) =>
      acquireLock(lockPath, `worker-${i}`).then(
        () => "won" as const,
        (err) =>
          err instanceof LockHeldError
            ? ("lost" as const)
            : Promise.reject(err),
      ),
    );
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === "won")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "lost")).toHaveLength(15);
  });
});

describe("withLock", () => {
  test("acquires, runs fn, releases", async () => {
    const lockPath = join(dir, "x.lock");
    let inside = false;
    const r = await withLock(lockPath, "worker-A", async () => {
      inside = true;
      // Lock is held during the body.
      expect(await Bun.file(lockPath).exists()).toBe(true);
      return 42;
    });
    expect(r).toBe(42);
    expect(inside).toBe(true);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("releases the lock even when fn throws", async () => {
    const lockPath = join(dir, "x.lock");
    await expect(
      withLock(lockPath, "worker-A", async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("propagates LockHeldError if the lock can't be acquired", async () => {
    const lockPath = join(dir, "x.lock");
    await acquireLock(lockPath, "worker-A");
    await expect(
      withLock(lockPath, "worker-B", async () => "never"),
    ).rejects.toBeInstanceOf(LockHeldError);
  });
});
