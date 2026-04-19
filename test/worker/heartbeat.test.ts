import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withDb } from "../../src/db/connection.ts";
import { getWorker, registerWorker } from "../../src/db/workers.ts";
import { startHeartbeat, startReaper } from "../../src/worker/heartbeat.ts";
import { setupTestDbFile } from "../helpers.ts";

let dbPath: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dbPath, cleanup } = await setupTestDbFile());
});

afterEach(async () => {
  await cleanup();
});

async function withWorker(id: string) {
  await withDb(dbPath, (conn) =>
    registerWorker(conn, {
      id,
      pid: process.pid,
      hostname: "test",
      mode: "persist",
    }),
  );
}

describe("startHeartbeat", () => {
  test("updates last_heartbeat_at repeatedly", async () => {
    await withWorker("hb-1");
    const before = await withDb(dbPath, (conn) => getWorker(conn, "hb-1"));
    expect(before).not.toBeNull();

    // 1s interval so the first tick fires quickly under the 1s minimum.
    const stop = startHeartbeat(dbPath, "hb-1", 1);
    await Bun.sleep(1200);
    stop();

    const after = await withDb(dbPath, (conn) => getWorker(conn, "hb-1"));
    expect(after?.last_heartbeat_at.getTime() ?? 0).toBeGreaterThan(
      before?.last_heartbeat_at.getTime() ?? 0,
    );
  });

  test("stop() prevents the heartbeat from running on non-running workers", async () => {
    await withWorker("hb-2");
    // Mark stopped so any later in-flight heartbeat is a no-op per the
    // `WHERE status='running'` guard.
    await withDb(dbPath, (conn) =>
      conn.queryRun("UPDATE workers SET status='stopped' WHERE id=?1", "hb-2"),
    );
    const before = await withDb(dbPath, (conn) => getWorker(conn, "hb-2"));
    const stop = startHeartbeat(dbPath, "hb-2", 1);
    await Bun.sleep(1200);
    stop();
    const after = await withDb(dbPath, (conn) => getWorker(conn, "hb-2"));
    expect(after?.last_heartbeat_at.getTime()).toBe(
      before?.last_heartbeat_at.getTime(),
    );
  });
});

describe("startReaper", () => {
  test("reaps workers whose heartbeat is older than threshold", async () => {
    await withWorker("reap-1");
    // Force heartbeat into the past
    await withDb(dbPath, (conn) =>
      conn.queryRun(
        "UPDATE workers SET last_heartbeat_at='2000-01-01 00:00:00' WHERE id=?1",
        "reap-1",
      ),
    );

    const stop = startReaper(dbPath, 1, 60);
    await Bun.sleep(1200);
    stop();

    const w = await withDb(dbPath, (conn) => getWorker(conn, "reap-1"));
    expect(w?.status).toBe("dead");
  });
});
