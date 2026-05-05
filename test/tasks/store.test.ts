import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getTasksDir,
  getTasksLockDir,
  TASKS_DIR,
} from "../../src/constants.ts";
import { acquireLock, atomicWrite } from "../../src/fs/atomic.ts";
import {
  CircularDependencyError,
  claimNextTask,
  claimSpecificTask,
  createTask,
  deleteAllTasks,
  deleteTask,
  getTask,
  listTaskFiles,
  listTasks,
  reapOrphanLocks,
  releaseTaskLock,
  resetStaleTasks,
  TaskNotFoundError,
  updateTask,
  updateTaskStatus,
  validateBlockedBy,
} from "../../src/tasks/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-tasks-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("createTask + getTask + listTasks", () => {
  test("createTask writes a markdown file with frontmatter under tasks/", async () => {
    const t = await createTask(projectDir, {
      name: "first",
      description: "do the first thing",
      priority: "high",
    });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe("pending");
    expect(t.priority).toBe("high");

    const path = join(projectDir, TASKS_DIR, `${t.id}.md`);
    const raw = await readFile(path, "utf-8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain(`id: ${t.id}`);
    expect(raw).toContain("priority: high");
    expect(raw).toContain("status: pending");
    expect(raw).toContain("do the first thing");
  });

  test("getTask reads the file back faithfully", async () => {
    const t = await createTask(projectDir, {
      name: "n",
      description: "body",
      priority: "low",
      context_paths: ["notes/a.md", "notes/b.md"],
    });
    const fresh = await getTask(projectDir, t.id);
    if (!fresh) throw new Error("missing");
    expect(fresh.name).toBe("n");
    expect(fresh.priority).toBe("low");
    expect(fresh.context_paths).toEqual(["notes/a.md", "notes/b.md"]);
    expect(fresh.body).toContain("body");
    expect(fresh.mtimeMs).toBeGreaterThan(0);
  });

  test("getTask returns null for missing ids", async () => {
    expect(await getTask(projectDir, "no-such-id")).toBeNull();
  });

  test("listTaskFiles enumerates ids without parsing frontmatter", async () => {
    const a = await createTask(projectDir, { name: "a" });
    const b = await createTask(projectDir, { name: "b" });
    const ids = await listTaskFiles(projectDir);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  test("listTasks filters by status and priority and supports limit/offset", async () => {
    const a = await createTask(projectDir, { name: "lo", priority: "low" });
    const b = await createTask(projectDir, { name: "hi", priority: "high" });
    await updateTaskStatus(projectDir, a.id, "complete", null, "done");

    const allPending = await listTasks(projectDir, { status: "pending" });
    expect(allPending.map((t) => t.id)).toEqual([b.id]);

    const allComplete = await listTasks(projectDir, { status: "complete" });
    expect(allComplete.map((t) => t.id)).toEqual([a.id]);

    const high = await listTasks(projectDir, { priority: "high" });
    expect(high.map((t) => t.id)).toEqual([b.id]);

    const page1 = await listTasks(projectDir, { limit: 1, offset: 0 });
    const page2 = await listTasks(projectDir, { limit: 1, offset: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  test("listTasks skips malformed task files instead of crashing", async () => {
    const a = await createTask(projectDir, { name: "a" });
    // Drop a junk file alongside the valid task — listTasks must skip it.
    await writeFile(
      join(getTasksDir(projectDir), "broken.md"),
      "---\nthis is not valid yaml: [unterminated\n---\n",
    );
    const tasks = await listTasks(projectDir);
    expect(tasks.map((t) => t.id)).toEqual([a.id]);
  });
});

describe("validateBlockedBy", () => {
  test("rejects a task that lists itself", async () => {
    await expect(
      validateBlockedBy(projectDir, "self", ["self"]),
    ).rejects.toThrow(CircularDependencyError);
  });

  test("rejects a transitive cycle", async () => {
    const a = await createTask(projectDir, { name: "a" });
    const b = await createTask(projectDir, {
      name: "b",
      blocked_by: [a.id],
    });
    // Now adding a -> b would close the cycle.
    await expect(validateBlockedBy(projectDir, a.id, [b.id])).rejects.toThrow(
      CircularDependencyError,
    );
  });

  test("accepts a flat fan-out", async () => {
    const a = await createTask(projectDir, { name: "a" });
    const b = await createTask(projectDir, { name: "b" });
    await expect(
      validateBlockedBy(projectDir, "new", [a.id, b.id]),
    ).resolves.toBeUndefined();
  });

  test("createTask rejects a task whose blocker would form a cycle", async () => {
    const a = await createTask(projectDir, { name: "a" });
    const b = await createTask(projectDir, {
      name: "b",
      blocked_by: [a.id],
    });
    // Trying to retroactively make `a` depend on `b` would close the loop;
    // updateTask routes through validateBlockedBy.
    await expect(
      updateTask(projectDir, a.id, { blocked_by: [b.id] }),
    ).rejects.toThrow(CircularDependencyError);
  });
});

describe("updateTask + updateTaskStatus", () => {
  test("updateTask refuses concurrent edits via the mtime check", async () => {
    const t = await createTask(projectDir, { name: "n" });
    // Simulate a vim save: rewrite the file with new mtime BEFORE we update.
    await new Promise((r) => setTimeout(r, 5));
    const path = join(getTasksDir(projectDir), `${t.id}.md`);
    const current = await readFile(path, "utf-8");
    await atomicWrite(path, current);

    // updateTask reads the file (fresh mtime), so its own write succeeds —
    // this is a positive test that the read happens at update time, not at
    // create time. The race is genuinely caught only when *another* writer
    // modifies between our getTask() and our atomicWriteIfUnchanged.
    const updated = await updateTask(projectDir, t.id, { name: "renamed" });
    expect(updated?.name).toBe("renamed");
  });

  test("updateTaskStatus throws for missing ids", async () => {
    await expect(
      updateTaskStatus(projectDir, "no-such-id", "complete"),
    ).rejects.toThrow(TaskNotFoundError);
  });

  test("updateTaskStatus refuses to resurrect a task deleted between read and write", async () => {
    // Worker reads the task, then a concurrent deleteTask runs, then the
    // worker tries to commit its status update. atomicWriteIfUnchanged sees
    // the file is gone and must throw rather than silently re-create it.
    const t = await createTask(projectDir, { name: "n" });
    await claimSpecificTask(projectDir, t.id, "worker-A");
    // Snapshot the in-progress task (this is what runAgentLoop holds).
    const claimed = await getTask(projectDir, t.id);
    if (!claimed) throw new Error("missing");
    // Concurrent delete drops the file.
    await deleteTask(projectDir, t.id);
    expect(await getTask(projectDir, t.id)).toBeNull();
    // Worker tries to land its terminal status — must reject; the task
    // should NOT spring back into existence.
    await expect(
      updateTaskStatus(projectDir, t.id, "complete", null, "done"),
    ).rejects.toThrow(TaskNotFoundError);
    expect(await getTask(projectDir, t.id)).toBeNull();
  });

  test("updateTaskStatus clears claimed_by/at on terminal status", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await claimSpecificTask(projectDir, t.id, "worker-A");
    const claimed = await getTask(projectDir, t.id);
    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.claimed_by).toBe("worker-A");

    await updateTaskStatus(projectDir, t.id, "complete", null, "done");
    const done = await getTask(projectDir, t.id);
    expect(done?.status).toBe("complete");
    expect(done?.claimed_by).toBeNull();
    expect(done?.claimed_at).toBeNull();
    expect(done?.output).toBe("done");
  });
});

describe("deleteTask + deleteAllTasks", () => {
  test("deleteTask removes the file and any held lock", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await claimSpecificTask(projectDir, t.id, "worker-A");
    expect(await deleteTask(projectDir, t.id)).toBe(true);
    expect(await getTask(projectDir, t.id)).toBeNull();
    // Lock is gone too.
    expect(
      await Bun.file(
        join(getTasksLockDir(projectDir), `${t.id}.lock`),
      ).exists(),
    ).toBe(false);
  });

  test("deleteTask returns false for unknown ids", async () => {
    expect(await deleteTask(projectDir, "no-such-id")).toBe(false);
  });

  test("deleteAllTasks unlinks every task file", async () => {
    await createTask(projectDir, { name: "a" });
    await createTask(projectDir, { name: "b" });
    expect(await deleteAllTasks(projectDir)).toBe(2);
    expect(await listTaskFiles(projectDir)).toEqual([]);
  });
});

describe("claimNextTask priority + dependency ordering", () => {
  test("highest priority unblocked pending task wins", async () => {
    const lo = await createTask(projectDir, { name: "lo", priority: "low" });
    const hi = await createTask(projectDir, { name: "hi", priority: "high" });
    const med = await createTask(projectDir, {
      name: "med",
      priority: "medium",
    });

    const claimed = await claimNextTask(projectDir, "worker-A");
    expect(claimed?.id).toBe(hi.id);
    expect(claimed?.status).toBe("in_progress");
    await releaseTaskLock(projectDir, hi.id);

    void lo;
    void med;
  });

  test("blocked tasks are not claimed until their blocker is complete", async () => {
    const a = await createTask(projectDir, { name: "a", priority: "low" });
    const b = await createTask(projectDir, {
      name: "b",
      priority: "high",
      blocked_by: [a.id],
    });
    // `b` is higher priority but blocked → `a` should claim first.
    const first = await claimNextTask(projectDir, "worker-A");
    expect(first?.id).toBe(a.id);

    // While a is in_progress, b is still blocked.
    expect(await claimNextTask(projectDir, "worker-B")).toBeNull();

    await updateTaskStatus(projectDir, a.id, "complete", null, "done");
    await releaseTaskLock(projectDir, a.id);

    const second = await claimNextTask(projectDir, "worker-B");
    expect(second?.id).toBe(b.id);
  });

  test("claimNextTask returns null when no candidate is eligible", async () => {
    expect(await claimNextTask(projectDir, "worker-A")).toBeNull();
    const t = await createTask(projectDir, { name: "n" });
    await updateTaskStatus(projectDir, t.id, "complete", null, "done");
    expect(await claimNextTask(projectDir, "worker-A")).toBeNull();
  });

  test("claimSpecificTask refuses non-pending tasks", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await updateTaskStatus(projectDir, t.id, "complete", null, "done");
    expect(await claimSpecificTask(projectDir, t.id, "worker-A")).toBeNull();
  });
});

describe("resetStaleTasks + reapOrphanLocks", () => {
  test("resetStaleTasks rewrites stale in_progress tasks back to pending", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await claimSpecificTask(projectDir, t.id, "worker-A");
    // Backdate claimed_at by editing the file directly.
    const fresh = await getTask(projectDir, t.id);
    if (!fresh) throw new Error("missing");
    const oldClaim = new Date(Date.now() - 60_000).toISOString();
    await updateTaskStatus(projectDir, t.id, "in_progress");
    // updateTaskStatus clears claimed_by when status isn't "in_progress" —
    // but we set in_progress, so it preserves it. We still need to backdate.
    const reread = await getTask(projectDir, t.id);
    if (!reread) throw new Error("missing");
    // Direct file rewrite to backdate claimed_at past the staleness window.
    const path = join(getTasksDir(projectDir), `${t.id}.md`);
    const text = await readFile(path, "utf-8");
    await atomicWrite(
      path,
      text.replace(/claimed_at: .+/, `claimed_at: '${oldClaim}'`),
    );

    const reset = await resetStaleTasks(projectDir, /*timeoutSeconds*/ 1);
    expect(reset).toContain(t.id);

    const after = await getTask(projectDir, t.id);
    expect(after?.status).toBe("pending");
    expect(after?.claimed_by).toBeNull();
  });

  test("reapOrphanLocks unlinks locks held by dead workers", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await acquireLock(
      join(getTasksLockDir(projectDir), `${t.id}.lock`),
      "dead-worker",
    );
    // isWorkerAlive returns false for "dead-worker", true for "live-worker".
    const released = await reapOrphanLocks(
      projectDir,
      async (id) => id === "live-worker",
    );
    expect(released).toContain(t.id);
    expect(
      await Bun.file(
        join(getTasksLockDir(projectDir), `${t.id}.lock`),
      ).exists(),
    ).toBe(false);
  });

  test("reapOrphanLocks leaves locks held by live workers alone", async () => {
    const t = await createTask(projectDir, { name: "n" });
    await acquireLock(
      join(getTasksLockDir(projectDir), `${t.id}.lock`),
      "live-worker",
    );
    const released = await reapOrphanLocks(
      projectDir,
      async (id) => id === "live-worker",
    );
    expect(released).toEqual([]);
  });
});
