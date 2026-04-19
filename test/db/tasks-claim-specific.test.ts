import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { claimSpecificTask, createTask, getTask } from "../../src/db/tasks.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

afterEach(() => {
  conn.close();
});

describe("claimSpecificTask", () => {
  test("claims a pending task by id", async () => {
    const task = await createTask(conn, { name: "t1" });
    const claimed = await claimSpecificTask(conn, task.id, "worker-a");
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.claimed_by).toBe("worker-a");
  });

  test("returns null when task is already claimed", async () => {
    const task = await createTask(conn, { name: "t1" });
    await claimSpecificTask(conn, task.id, "worker-a");
    const second = await claimSpecificTask(conn, task.id, "worker-b");
    expect(second).toBeNull();
    const fresh = await getTask(conn, task.id);
    expect(fresh?.claimed_by).toBe("worker-a");
  });

  test("returns null when task id does not exist", async () => {
    const claimed = await claimSpecificTask(conn, "nonexistent", "worker-a");
    expect(claimed).toBeNull();
  });

  test("returns null when task is not pending", async () => {
    const task = await createTask(conn, { name: "t1" });
    await conn.queryRun(
      "UPDATE tasks SET status='complete' WHERE id=?1",
      task.id,
    );
    const claimed = await claimSpecificTask(conn, task.id, "worker-a");
    expect(claimed).toBeNull();
  });
});
