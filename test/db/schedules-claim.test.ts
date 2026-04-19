import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  claimSchedule,
  createSchedule,
  markScheduleRun,
  releaseSchedule,
} from "../../src/db/schedules.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

afterEach(() => {
  conn.close();
});

const OPTS = { staleAfterSeconds: 300, minIntervalSeconds: 60 };

describe("claimSchedule", () => {
  test("first claimer wins", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    const claimed = await claimSchedule(conn, s.id, "worker-a", OPTS);
    expect(claimed?.claimed_by).toBe("worker-a");
  });

  test("second concurrent claimer gets null", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    const a = await claimSchedule(conn, s.id, "worker-a", OPTS);
    const b = await claimSchedule(conn, s.id, "worker-b", OPTS);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  test("disabled schedule cannot be claimed", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    await conn.queryRun("UPDATE schedules SET enabled=false WHERE id=?1", s.id);
    const claimed = await claimSchedule(conn, s.id, "worker-a", OPTS);
    expect(claimed).toBeNull();
  });

  test("schedule within min-interval cannot be claimed", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    await markScheduleRun(conn, s.id);
    const claimed = await claimSchedule(conn, s.id, "worker-a", OPTS);
    expect(claimed).toBeNull();
  });

  test("releaseSchedule clears own claim only", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    await claimSchedule(conn, s.id, "worker-a", OPTS);
    // Another worker trying to release should be a no-op
    await releaseSchedule(conn, s.id, "worker-b");
    const row = await conn.queryGet<{ claimed_by: string | null }>(
      "SELECT claimed_by FROM schedules WHERE id=?1",
      s.id,
    );
    expect(row?.claimed_by).toBe("worker-a");
    // The correct owner can release
    await releaseSchedule(conn, s.id, "worker-a");
    const row2 = await conn.queryGet<{ claimed_by: string | null }>(
      "SELECT claimed_by FROM schedules WHERE id=?1",
      s.id,
    );
    expect(row2?.claimed_by).toBeNull();
  });

  test("stale claim can be stolen by another worker", async () => {
    const s = await createSchedule(conn, { name: "s1", frequency: "daily" });
    await claimSchedule(conn, s.id, "worker-a", OPTS);
    // Force the claim into the past
    await conn.queryRun(
      "UPDATE schedules SET claimed_at='2000-01-01 00:00:00' WHERE id=?1",
      s.id,
    );
    const stolen = await claimSchedule(conn, s.id, "worker-b", OPTS);
    expect(stolen?.claimed_by).toBe("worker-b");
  });
});
