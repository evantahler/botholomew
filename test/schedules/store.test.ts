import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSchedulesDir,
  getSchedulesLockDir,
  SCHEDULES_DIR,
} from "../../src/constants.ts";
import { acquireLock, LockHeldError } from "../../src/fs/atomic.ts";
import {
  createSchedule,
  deleteAllSchedules,
  deleteSchedule,
  getSchedule,
  listScheduleFiles,
  listSchedules,
  markScheduleRun,
  reapOrphanScheduleLocks,
  updateSchedule,
  withScheduleLock,
} from "../../src/schedules/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-schedules-"));
  await mkdir(getSchedulesDir(projectDir), { recursive: true });
  await mkdir(getSchedulesLockDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("createSchedule + getSchedule + listSchedules", () => {
  test("createSchedule writes a markdown file under schedules/", async () => {
    const s = await createSchedule(projectDir, {
      name: "morning",
      description: "summarize email",
      frequency: "every weekday at 7am",
    });
    expect(s.id).toBeTruthy();
    expect(s.enabled).toBe(true);
    expect(s.last_run_at).toBeNull();

    const path = join(projectDir, SCHEDULES_DIR, `${s.id}.md`);
    expect(await Bun.file(path).exists()).toBe(true);
  });

  test("createSchedule supplies a default empty description", async () => {
    const s = await createSchedule(projectDir, {
      name: "n",
      frequency: "daily",
    });
    expect(s.description).toBe("");
  });

  test("getSchedule returns null for missing ids", async () => {
    expect(await getSchedule(projectDir, "no-such-id")).toBeNull();
  });

  test("listScheduleFiles enumerates ids", async () => {
    const a = await createSchedule(projectDir, { name: "a", frequency: "f" });
    const b = await createSchedule(projectDir, { name: "b", frequency: "f" });
    const ids = await listScheduleFiles(projectDir);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  test("listSchedules supports limit, offset, and enabled filter", async () => {
    const a = await createSchedule(projectDir, { name: "a", frequency: "f" });
    await createSchedule(projectDir, { name: "b", frequency: "f" });
    await updateSchedule(projectDir, a.id, { enabled: false });

    const enabled = await listSchedules(projectDir, { enabled: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.name).toBe("b");

    const disabled = await listSchedules(projectDir, { enabled: false });
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.name).toBe("a");

    const page1 = await listSchedules(projectDir, { limit: 1, offset: 0 });
    const page2 = await listSchedules(projectDir, { limit: 1, offset: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });
});

describe("updateSchedule", () => {
  test("updates name, description, frequency, enabled", async () => {
    const s = await createSchedule(projectDir, {
      name: "old",
      frequency: "daily",
    });
    const updated = await updateSchedule(projectDir, s.id, {
      name: "new",
      description: "desc",
      frequency: "weekly",
      enabled: false,
    });
    expect(updated?.name).toBe("new");
    expect(updated?.description).toBe("desc");
    expect(updated?.frequency).toBe("weekly");
    expect(updated?.enabled).toBe(false);
  });

  test("omits undefined keys (does not clobber existing values)", async () => {
    const s = await createSchedule(projectDir, {
      name: "n",
      description: "keepme",
      frequency: "f",
    });
    const updated = await updateSchedule(projectDir, s.id, {
      enabled: false,
    });
    expect(updated?.description).toBe("keepme");
    expect(updated?.enabled).toBe(false);
  });

  test("returns null for missing ids", async () => {
    expect(
      await updateSchedule(projectDir, "no-such-id", { name: "x" }),
    ).toBeNull();
  });
});

describe("deleteSchedule + deleteAllSchedules", () => {
  test("deleteSchedule unlinks the file", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    expect(await deleteSchedule(projectDir, s.id)).toBe(true);
    expect(await getSchedule(projectDir, s.id)).toBeNull();
  });

  test("deleteSchedule on unknown id returns false", async () => {
    expect(await deleteSchedule(projectDir, "no-such-id")).toBe(false);
  });

  test("deleteAllSchedules unlinks every file", async () => {
    await createSchedule(projectDir, { name: "a", frequency: "f" });
    await createSchedule(projectDir, { name: "b", frequency: "f" });
    expect(await deleteAllSchedules(projectDir)).toBe(2);
    expect(await listScheduleFiles(projectDir)).toEqual([]);
  });
});

describe("withScheduleLock + markScheduleRun", () => {
  test("acquires the lock, runs fn, releases on normal completion", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    let inside = false;
    const result = await withScheduleLock(
      projectDir,
      s.id,
      "worker-A",
      { minIntervalSeconds: 0 },
      async () => {
        inside = true;
        return "ok";
      },
    );
    expect(result).toBe("ok");
    expect(inside).toBe(true);
    // Lock is gone after the body returns.
    const lockPath = join(getSchedulesLockDir(projectDir), `${s.id}.lock`);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("releases the lock even when fn throws", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    await expect(
      withScheduleLock(
        projectDir,
        s.id,
        "worker-A",
        { minIntervalSeconds: 0 },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    const lockPath = join(getSchedulesLockDir(projectDir), `${s.id}.lock`);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("returns null without invoking fn when another worker holds the lock", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    await acquireLock(
      join(getSchedulesLockDir(projectDir), `${s.id}.lock`),
      "worker-A",
    );
    let invoked = false;
    const result = await withScheduleLock(
      projectDir,
      s.id,
      "worker-B",
      { minIntervalSeconds: 0 },
      async () => {
        invoked = true;
        return "should-not-happen";
      },
    );
    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });

  test("returns null when the schedule is disabled", async () => {
    const s = await createSchedule(projectDir, {
      name: "n",
      frequency: "f",
      enabled: false,
    });
    let invoked = false;
    const result = await withScheduleLock(
      projectDir,
      s.id,
      "worker-A",
      { minIntervalSeconds: 0 },
      async () => {
        invoked = true;
        return "x";
      },
    );
    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });

  test("respects min-interval window since last_run_at", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    await markScheduleRun(projectDir, s.id);
    let invoked = false;
    const result = await withScheduleLock(
      projectDir,
      s.id,
      "worker-A",
      { minIntervalSeconds: 60 },
      async () => {
        invoked = true;
        return "x";
      },
    );
    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });

  test("markScheduleRun updates last_run_at", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    expect(s.last_run_at).toBeNull();
    await markScheduleRun(projectDir, s.id);
    const after = await getSchedule(projectDir, s.id);
    expect(after?.last_run_at).toBeTruthy();
    expect(Date.parse(after?.last_run_at ?? "")).not.toBeNaN();
  });
});

describe("reapOrphanScheduleLocks", () => {
  test("releases locks held by dead workers", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    await acquireLock(
      join(getSchedulesLockDir(projectDir), `${s.id}.lock`),
      "dead-worker",
    );
    const released = await reapOrphanScheduleLocks(
      projectDir,
      async (id) => id === "live-worker",
    );
    expect(released).toContain(s.id);
  });

  test("leaves locks held by live workers alone", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    await acquireLock(
      join(getSchedulesLockDir(projectDir), `${s.id}.lock`),
      "live-worker",
    );
    const released = await reapOrphanScheduleLocks(
      projectDir,
      async (id) => id === "live-worker",
    );
    expect(released).toEqual([]);
  });
});

describe("schedule claim race", () => {
  test("only one of two concurrent claims wins", async () => {
    const s = await createSchedule(projectDir, { name: "n", frequency: "f" });
    let aRan = false;
    let bRan = false;
    const [aResult, bResult] = await Promise.all([
      withScheduleLock(
        projectDir,
        s.id,
        "worker-A",
        { minIntervalSeconds: 0 },
        async () => {
          aRan = true;
          // Hold the lock briefly so worker-B has time to fail.
          await new Promise((r) => setTimeout(r, 20));
          return "A";
        },
      ),
      withScheduleLock(
        projectDir,
        s.id,
        "worker-B",
        { minIntervalSeconds: 0 },
        async () => {
          bRan = true;
          return "B";
        },
      ),
    ]);
    const winners = [aResult, bResult].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    // Exactly one fn body ran.
    expect([aRan, bRan].filter(Boolean)).toHaveLength(1);
  });

  // Verify acquireLock surfaces LockHeldError as the underlying mechanism.
  test("acquireLock throws LockHeldError on EEXIST", async () => {
    const lockPath = join(getSchedulesLockDir(projectDir), "x.lock");
    await acquireLock(lockPath, "worker-A");
    await expect(acquireLock(lockPath, "worker-B")).rejects.toBeInstanceOf(
      LockHeldError,
    );
  });
});
