import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  claimNextTask,
  createTask,
  updateTaskStatus,
} from "../../src/db/tasks.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("claimNextTask race condition", () => {
  test("skips already-claimed task and claims next candidate", async () => {
    // Create two pending tasks — high priority first
    const high = await createTask(conn, {
      name: "High priority",
      priority: "high",
    });
    await createTask(conn, {
      name: "Low priority",
      priority: "low",
    });

    // Simulate race: manually claim the high-priority task between read and update
    await updateTaskStatus(conn, high.id, "in_progress");

    // claimNextTask should skip the already-claimed high and claim the low
    const claimed = await claimNextTask(conn);
    expect(claimed).not.toBeNull();
    expect(claimed?.name).toBe("Low priority");
    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.claimed_by).toBe("daemon");
  });

  test("returns null when all candidates are already claimed", async () => {
    const task = await createTask(conn, { name: "Only task" });

    // Claim it externally before claimNextTask runs
    await updateTaskStatus(conn, task.id, "in_progress");

    const claimed = await claimNextTask(conn);
    expect(claimed).toBeNull();
  });

  test("skips multiple already-claimed tasks", async () => {
    const t1 = await createTask(conn, { name: "T1", priority: "high" });
    const t2 = await createTask(conn, { name: "T2", priority: "medium" });
    await createTask(conn, { name: "T3", priority: "low" });

    // Claim both high and medium externally
    await updateTaskStatus(conn, t1.id, "in_progress");
    await updateTaskStatus(conn, t2.id, "in_progress");

    const claimed = await claimNextTask(conn);
    expect(claimed).not.toBeNull();
    expect(claimed?.name).toBe("T3");
  });

  test("claims with custom claimedBy value", async () => {
    await createTask(conn, { name: "Task", priority: "medium" });

    const claimed = await claimNextTask(conn, "worker-2");
    expect(claimed).not.toBeNull();
    expect(claimed?.claimed_by).toBe("worker-2");
  });
});
