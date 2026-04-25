import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { createTask } from "../../src/db/tasks.ts";
import {
  getWorker,
  heartbeat,
  listWorkers,
  markWorkerDead,
  markWorkerStopped,
  pruneStoppedWorkers,
  reapDeadWorkers,
  registerWorker,
} from "../../src/db/workers.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

afterEach(() => {
  conn.close();
});

describe("worker registration", () => {
  test("registers a worker row with status=running", async () => {
    const w = await registerWorker(conn, {
      id: "w-1",
      pid: 1234,
      hostname: "testhost",
      mode: "persist",
    });
    expect(w.id).toBe("w-1");
    expect(w.status).toBe("running");
    expect(w.pid).toBe(1234);
    expect(w.mode).toBe("persist");
    expect(w.task_id).toBeNull();
  });

  test("stores the pinned taskId when provided", async () => {
    const w = await registerWorker(conn, {
      id: "w-2",
      pid: 1,
      hostname: "h",
      mode: "once",
      taskId: "task-42",
    });
    expect(w.task_id).toBe("task-42");
  });

  test("stores logPath and round-trips through getWorker / listWorkers", async () => {
    const w = await registerWorker(conn, {
      id: "w-log-1",
      pid: 1,
      hostname: "h",
      mode: "persist",
      logPath: "/tmp/proj/.botholomew/logs/w-log-1.log",
    });
    expect(w.log_path).toBe("/tmp/proj/.botholomew/logs/w-log-1.log");

    const fetched = await getWorker(conn, "w-log-1");
    expect(fetched?.log_path).toBe("/tmp/proj/.botholomew/logs/w-log-1.log");

    const listed = await listWorkers(conn, { status: "running" });
    const found = listed.find((row) => row.id === "w-log-1");
    expect(found?.log_path).toBe("/tmp/proj/.botholomew/logs/w-log-1.log");
  });

  test("log_path defaults to null when omitted", async () => {
    const w = await registerWorker(conn, {
      id: "w-log-2",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    expect(w.log_path).toBeNull();
  });

  test("heartbeat advances last_heartbeat_at", async () => {
    await registerWorker(conn, {
      id: "w-3",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    const before = await getWorker(conn, "w-3");
    expect(before).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    await heartbeat(conn, "w-3");
    const after = await getWorker(conn, "w-3");
    expect(after?.last_heartbeat_at.getTime() ?? 0).toBeGreaterThanOrEqual(
      before?.last_heartbeat_at.getTime() ?? 0,
    );
  });

  test("markWorkerStopped sets status=stopped and stopped_at", async () => {
    await registerWorker(conn, {
      id: "w-4",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    await markWorkerStopped(conn, "w-4");
    const w = await getWorker(conn, "w-4");
    expect(w?.status).toBe("stopped");
    expect(w?.stopped_at).not.toBeNull();
  });

  test("markWorkerDead sets status=dead and stopped_at", async () => {
    await registerWorker(conn, {
      id: "w-5",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    await markWorkerDead(conn, "w-5");
    const w = await getWorker(conn, "w-5");
    expect(w?.status).toBe("dead");
  });

  test("listWorkers filters by status", async () => {
    await registerWorker(conn, {
      id: "w-a",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    await registerWorker(conn, {
      id: "w-b",
      pid: 2,
      hostname: "h",
      mode: "persist",
    });
    await markWorkerStopped(conn, "w-a");
    const running = await listWorkers(conn, { status: "running" });
    const stopped = await listWorkers(conn, { status: "stopped" });
    expect(running.map((w) => w.id)).toEqual(["w-b"]);
    expect(stopped.map((w) => w.id)).toEqual(["w-a"]);
  });
});

describe("reapDeadWorkers", () => {
  test("marks stale workers as dead and releases their claimed tasks", async () => {
    await registerWorker(conn, {
      id: "stale-1",
      pid: 1,
      hostname: "h",
      mode: "persist",
    });

    // Claim a task under the stale worker id
    const task = await createTask(conn, { name: "t1" });
    await conn.queryRun(
      `UPDATE tasks SET status='in_progress', claimed_by=?1,
       claimed_at=current_timestamp::VARCHAR WHERE id=?2`,
      "stale-1",
      task.id,
    );

    // Force the heartbeat back in time
    await conn.queryRun(
      `UPDATE workers SET last_heartbeat_at='2000-01-01 00:00:00' WHERE id=?1`,
      "stale-1",
    );

    const reaped = await reapDeadWorkers(conn, 60);
    expect(reaped).toEqual(["stale-1"]);

    const worker = await getWorker(conn, "stale-1");
    expect(worker?.status).toBe("dead");

    const reclaimed = await conn.queryGet<{
      status: string;
      claimed_by: string | null;
    }>(`SELECT status, claimed_by FROM tasks WHERE id=?1`, task.id);
    expect(reclaimed?.status).toBe("pending");
    expect(reclaimed?.claimed_by).toBeNull();
  });

  test("leaves fresh workers untouched", async () => {
    await registerWorker(conn, {
      id: "fresh-1",
      pid: 1,
      hostname: "h",
      mode: "persist",
    });
    const reaped = await reapDeadWorkers(conn, 60);
    expect(reaped).toEqual([]);
    const w = await getWorker(conn, "fresh-1");
    expect(w?.status).toBe("running");
  });

  test("pruneStoppedWorkers removes only cleanly-stopped workers past the retention window", async () => {
    await registerWorker(conn, {
      id: "old-stopped",
      pid: 1,
      hostname: "h",
      mode: "once",
    });
    await registerWorker(conn, {
      id: "recent-stopped",
      pid: 2,
      hostname: "h",
      mode: "once",
    });
    await registerWorker(conn, {
      id: "still-running",
      pid: 3,
      hostname: "h",
      mode: "persist",
    });
    await registerWorker(conn, {
      id: "old-dead",
      pid: 4,
      hostname: "h",
      mode: "persist",
    });

    await markWorkerStopped(conn, "old-stopped");
    await markWorkerStopped(conn, "recent-stopped");
    await markWorkerDead(conn, "old-dead");

    // Age out the two "old-*" workers
    await conn.queryRun(
      `UPDATE workers SET stopped_at='2000-01-01 00:00:00' WHERE id=?1 OR id=?2`,
      "old-stopped",
      "old-dead",
    );

    const pruned = await pruneStoppedWorkers(conn, 3600);
    expect(pruned).toEqual(["old-stopped"]);

    // Recent stopped stays, dead stays (forensics), running untouched
    expect(await getWorker(conn, "old-stopped")).toBeNull();
    expect((await getWorker(conn, "recent-stopped"))?.status).toBe("stopped");
    expect((await getWorker(conn, "still-running"))?.status).toBe("running");
    expect((await getWorker(conn, "old-dead"))?.status).toBe("dead");
  });

  test("clears schedule claims held by reaped workers", async () => {
    await registerWorker(conn, {
      id: "stale-2",
      pid: 1,
      hostname: "h",
      mode: "persist",
    });
    const scheduleId = "sched-1";
    await conn.queryRun(
      `INSERT INTO schedules (id, name, frequency, claimed_by, claimed_at)
       VALUES (?1, 'test', 'daily', ?2, current_timestamp::VARCHAR)`,
      scheduleId,
      "stale-2",
    );
    await conn.queryRun(
      `UPDATE workers SET last_heartbeat_at='2000-01-01 00:00:00' WHERE id=?1`,
      "stale-2",
    );

    await reapDeadWorkers(conn, 60);

    const row = await conn.queryGet<{
      claimed_by: string | null;
      claimed_at: string | null;
    }>(`SELECT claimed_by, claimed_at FROM schedules WHERE id=?1`, scheduleId);
    expect(row?.claimed_by).toBeNull();
    expect(row?.claimed_at).toBeNull();
  });
});
