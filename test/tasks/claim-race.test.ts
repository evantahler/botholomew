/**
 * Multi-worker claim race tests. With tasks-as-files + O_EXCL lockfiles, the
 * kernel arbitrates: every concurrent attempt to claim the same task either
 * wins or gets EEXIST. These tests assert the security property — exactly one
 * worker wins, no double-claim is ever observable on disk — by spinning up
 * many simultaneous claim attempts and counting outcomes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTasksDir, getTasksLockDir } from "../../src/constants.ts";
import {
  claimNextTask,
  claimSpecificTask,
  createTask,
  getTask,
  releaseTaskLock,
} from "../../src/tasks/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-tasks-race-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("claim race — exactly one worker wins per task", () => {
  test("16 concurrent claimNextTask attempts on one task — exactly one win", async () => {
    const t = await createTask(projectDir, { name: "the-only-one" });

    const workerCount = 16;
    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, i) =>
        claimNextTask(projectDir, `worker-${i}`),
      ),
    );

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(t.id);

    const ondisk = await getTask(projectDir, t.id);
    expect(ondisk?.status).toBe("in_progress");
    expect(ondisk?.claimed_by).toBe(winners[0]?.claimed_by);
  });

  test("two workers racing on claimSpecificTask — exactly one wins", async () => {
    const t = await createTask(projectDir, { name: "n" });
    const [a, b] = await Promise.all([
      claimSpecificTask(projectDir, t.id, "worker-A"),
      claimSpecificTask(projectDir, t.id, "worker-B"),
    ]);
    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
  });

  test("N workers + N tasks — each task claimed by exactly one worker", async () => {
    const N = 8;
    const tasks = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        createTask(projectDir, { name: `t-${i}` }),
      ),
    );
    const taskIds = new Set(tasks.map((t) => t.id));

    // Many more workers than tasks; the surplus must come back null.
    const workerCount = N * 3;
    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, i) =>
        claimNextTask(projectDir, `worker-${i}`),
      ),
    );

    const wins = results.filter((r) => r !== null);
    expect(wins).toHaveLength(N);

    // Every task got claimed exactly once — no duplicates.
    const claimedIds = wins.map((w) => w?.id);
    expect(new Set(claimedIds)).toEqual(taskIds);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });

  test("losing claimNextTask returns null without altering other tasks", async () => {
    const a = await createTask(projectDir, { name: "a", priority: "high" });
    const b = await createTask(projectDir, { name: "b", priority: "medium" });

    // Worker A claims `a`; another worker B then asks for "next" — should
    // claim `b`, not return null and not corrupt `a`.
    const first = await claimNextTask(projectDir, "worker-A");
    expect(first?.id).toBe(a.id);

    const second = await claimNextTask(projectDir, "worker-B");
    expect(second?.id).toBe(b.id);

    const aSnapshot = await getTask(projectDir, a.id);
    expect(aSnapshot?.claimed_by).toBe("worker-A");
    await releaseTaskLock(projectDir, a.id);
    await releaseTaskLock(projectDir, b.id);
  });

  test("releasing a lock allows re-claim", async () => {
    const t = await createTask(projectDir, { name: "n" });
    const first = await claimNextTask(projectDir, "worker-A");
    expect(first?.id).toBe(t.id);

    // Release the lock and reset to pending, simulating a wait/retry.
    await releaseTaskLock(projectDir, t.id);
    // The on-disk task is still in_progress, but if we manually flip back
    // to pending another worker can re-claim. (Real worker code does this
    // via wait_task or resetStaleTasks.)
    const { updateTask } = await import("../../src/tasks/store.ts");
    await updateTask(projectDir, t.id, { status: "pending" });

    const second = await claimNextTask(projectDir, "worker-B");
    expect(second?.id).toBe(t.id);
    expect(second?.claimed_by).toBe("worker-B");
  });
});
