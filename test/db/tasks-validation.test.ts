import { beforeEach, describe, expect, test } from "bun:test";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import {
  createTask,
  deleteTask,
  getTask,
  resetStaleTasks,
  resetTask,
  updateTask,
  updateTaskStatus,
} from "../../src/db/tasks.ts";

let conn: DbConnection;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
});

describe("cycle detection", () => {
  test("rejects direct self-reference", async () => {
    const a = await createTask(conn, { name: "A" });
    await expect(
      updateTask(conn, a.id, { blocked_by: [a.id] }),
    ).rejects.toThrow("cannot block itself");
  });

  test("rejects simple A↔B cycle", async () => {
    const a = await createTask(conn, { name: "A" });
    const b = await createTask(conn, { name: "B", blocked_by: [a.id] });

    await expect(
      updateTask(conn, a.id, { blocked_by: [b.id] }),
    ).rejects.toThrow("Circular dependency");
  });

  test("rejects deep A→B→C→A cycle", async () => {
    const a = await createTask(conn, { name: "A" });
    const b = await createTask(conn, { name: "B", blocked_by: [a.id] });
    const c = await createTask(conn, { name: "C", blocked_by: [b.id] });

    await expect(
      updateTask(conn, a.id, { blocked_by: [c.id] }),
    ).rejects.toThrow("Circular dependency");
  });

  test("allows valid chain (no cycle)", async () => {
    const a = await createTask(conn, { name: "A" });
    const b = await createTask(conn, { name: "B", blocked_by: [a.id] });
    const c = await createTask(conn, { name: "C", blocked_by: [b.id] });

    // This is fine — no cycle
    expect(c.blocked_by).toEqual([b.id]);
  });

  test("allows diamond dependency (not a cycle)", async () => {
    const d = await createTask(conn, { name: "D" });
    const b = await createTask(conn, { name: "B", blocked_by: [d.id] });
    const c = await createTask(conn, { name: "C", blocked_by: [d.id] });
    const a = await createTask(conn, {
      name: "A",
      blocked_by: [b.id, c.id],
    });

    expect(a.blocked_by).toEqual([b.id, c.id]);
  });
});

describe("updateTask", () => {
  test("updates name and priority", async () => {
    const task = await createTask(conn, { name: "Original" });

    const updated = await updateTask(conn, task.id, {
      name: "New name",
      priority: "high",
    });

    expect(updated?.name).toBe("New name");
    expect(updated?.priority).toBe("high");
  });

  test("updates status", async () => {
    const task = await createTask(conn, { name: "Task" });
    const updated = await updateTask(conn, task.id, { status: "complete" });
    expect(updated?.status).toBe("complete");
  });

  test("empty updates returns current task", async () => {
    const task = await createTask(conn, { name: "Task" });
    const same = await updateTask(conn, task.id, {});
    expect(same?.name).toBe("Task");
  });

  test("update nonexistent task returns null", async () => {
    const result = await updateTask(conn, "nonexistent", { name: "X" });
    expect(result).toBeNull();
  });
});

describe("deleteTask", () => {
  test("deletes existing task", async () => {
    const task = await createTask(conn, { name: "To delete" });
    const deleted = await deleteTask(conn, task.id);
    expect(deleted).toBe(true);

    const fetched = await getTask(conn, task.id);
    expect(fetched).toBeNull();
  });

  test("delete nonexistent returns false", async () => {
    const deleted = await deleteTask(conn, "nonexistent");
    expect(deleted).toBe(false);
  });
});

describe("resetTask", () => {
  test("resets in_progress task to pending", async () => {
    const task = await createTask(conn, { name: "Stuck" });
    await updateTaskStatus(conn, task.id, "in_progress");

    const reset = await resetTask(conn, task.id);
    expect(reset?.status).toBe("pending");
    expect(reset?.claimed_by).toBeNull();
    expect(reset?.claimed_at).toBeNull();
    expect(reset?.waiting_reason).toBeNull();
  });

  test("reset nonexistent returns null", async () => {
    const result = await resetTask(conn, "nonexistent");
    expect(result).toBeNull();
  });
});

describe("resetStaleTasks", () => {
  test("resets tasks with old claimed_at", async () => {
    const task = await createTask(conn, { name: "Stale" });

    // Manually set to in_progress with old claimed_at
    conn
      .query(
        `UPDATE tasks
       SET status = 'in_progress', claimed_by = 'daemon',
           claimed_at = datetime('now', '-1 hour')
       WHERE id = ?1`,
      )
      .run(task.id);

    const resetIds = await resetStaleTasks(conn, 60); // 60s timeout
    expect(resetIds).toContain(task.id);

    const fetched = await getTask(conn, task.id);
    expect(fetched?.status).toBe("pending");
    expect(fetched?.claimed_by).toBeNull();
  });

  test("does not reset recent in_progress tasks", async () => {
    const task = await createTask(conn, { name: "Active" });

    conn
      .query(
        `UPDATE tasks
       SET status = 'in_progress', claimed_by = 'daemon',
           claimed_at = datetime('now')
       WHERE id = ?1`,
      )
      .run(task.id);

    const resetIds = await resetStaleTasks(conn, 60);
    expect(resetIds).not.toContain(task.id);
  });

  test("does not reset non-in_progress tasks", async () => {
    const task = await createTask(conn, { name: "Pending" });

    const resetIds = await resetStaleTasks(conn, 60);
    expect(resetIds).not.toContain(task.id);
  });
});
