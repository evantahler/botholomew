/**
 * startHeartbeat / startReaper drive the worker liveness signal: each tick
 * rewrites the worker's pidfile (workers/<id>.json) with a fresh
 * last_heartbeat_at; the reaper marks dead workers and unlinks orphan
 * task/schedule lockfiles. These tests boot the real interval timers
 * with short windows and assert observable behavior on disk.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getTasksDir,
  getTasksLockDir,
  getWorkersDir,
} from "../../src/constants.ts";
import { acquireLock } from "../../src/fs/atomic.ts";
import { startHeartbeat, startReaper } from "../../src/worker/heartbeat.ts";
import { getWorker, registerWorker } from "../../src/workers/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-heartbeat-"));
  await mkdir(getWorkersDir(projectDir), { recursive: true });
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function registerOne(id: string) {
  await registerWorker(projectDir, {
    id,
    pid: process.pid,
    hostname: "test",
    mode: "persist",
  });
}

describe("startHeartbeat", () => {
  test("rewrites last_heartbeat_at over time", async () => {
    await registerOne("hb-1");
    const before = await getWorker(projectDir, "hb-1");
    if (!before) throw new Error("missing");

    const stop = startHeartbeat(projectDir, "hb-1", 1);
    await Bun.sleep(1300);
    stop();

    const after = await getWorker(projectDir, "hb-1");
    expect(
      Date.parse(after?.last_heartbeat_at ?? "0") -
        Date.parse(before.last_heartbeat_at),
    ).toBeGreaterThan(0);
  });

  test("does not resurrect a stopped worker", async () => {
    await registerOne("hb-2");
    // Manually flip status to stopped — a heartbeat that fires after this
    // should be a no-op (heartbeat() short-circuits non-running workers).
    const w = await getWorker(projectDir, "hb-2");
    if (!w) throw new Error("missing");
    const { atomicWrite } = await import("../../src/fs/atomic.ts");
    const path = join(getWorkersDir(projectDir), "hb-2.json");
    await atomicWrite(
      path,
      JSON.stringify({
        ...w,
        status: "stopped",
        stopped_at: new Date().toISOString(),
      }),
    );
    const before = await getWorker(projectDir, "hb-2");

    const stop = startHeartbeat(projectDir, "hb-2", 1);
    await Bun.sleep(1300);
    stop();

    const after = await getWorker(projectDir, "hb-2");
    expect(after?.status).toBe("stopped");
    expect(after?.last_heartbeat_at).toBe(before?.last_heartbeat_at);
  });
});

describe("startReaper", () => {
  test("flips workers whose heartbeat is older than threshold to status=dead", async () => {
    await registerOne("dead-1");
    // Backdate this worker's heartbeat so the reaper sees it as stale.
    const old = new Date(Date.now() - 60_000).toISOString();
    const path = join(getWorkersDir(projectDir), "dead-1.json");
    const w = await getWorker(projectDir, "dead-1");
    if (!w) throw new Error("missing");
    const { atomicWrite } = await import("../../src/fs/atomic.ts");
    await atomicWrite(path, JSON.stringify({ ...w, last_heartbeat_at: old }));

    const stop = startReaper(
      projectDir,
      /*intervalSeconds*/ 1,
      /*staleAfterSeconds*/ 5,
      /*stoppedRetentionSeconds*/ 3600,
    );
    await Bun.sleep(1300);
    stop();

    const after = await getWorker(projectDir, "dead-1");
    expect(after?.status).toBe("dead");
  });

  test("releases task lockfiles whose holder is no longer running", async () => {
    // Register a worker that's NOT in `workers/`, then drop a lockfile
    // claiming to be held by that worker. The reaper should unlink the
    // lockfile on the next tick.
    const lockPath = join(getTasksLockDir(projectDir), "task-X.lock");
    await acquireLock(lockPath, "ghost-worker");
    expect(await Bun.file(lockPath).exists()).toBe(true);

    const stop = startReaper(projectDir, 1, 5, 3600);
    await Bun.sleep(1300);
    stop();

    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("leaves task lockfiles held by running workers alone", async () => {
    await registerOne("alive-1");
    const lockPath = join(getTasksLockDir(projectDir), "task-Y.lock");
    await acquireLock(lockPath, "alive-1");

    const stop = startReaper(projectDir, 1, 5, 3600);
    await Bun.sleep(1300);
    stop();

    expect(await Bun.file(lockPath).exists()).toBe(true);
  });
});
