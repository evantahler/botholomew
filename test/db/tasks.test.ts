import { describe, expect, test, beforeEach } from "bun:test";
import { getMemoryConnection, type DuckDBConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  claimNextTask,
} from "../../src/db/tasks.ts";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await getMemoryConnection();
  await migrate(conn);
});

describe("task CRUD", () => {
  test("create and get a task", async () => {
    const task = await createTask(conn, {
      name: "Test task",
      description: "A test",
      priority: "high",
    });

    expect(task.name).toBe("Test task");
    expect(task.description).toBe("A test");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("pending");
    expect(task.id).toBeTruthy();

    const fetched = await getTask(conn, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test task");
  });

  test("list tasks ordered by priority", async () => {
    await createTask(conn, { name: "Low", priority: "low" });
    await createTask(conn, { name: "High", priority: "high" });
    await createTask(conn, { name: "Medium", priority: "medium" });

    const tasks = await listTasks(conn);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.name).toBe("High");
    expect(tasks[1]!.name).toBe("Medium");
    expect(tasks[2]!.name).toBe("Low");
  });

  test("list tasks with status filter", async () => {
    const task = await createTask(conn, { name: "Task 1" });
    await createTask(conn, { name: "Task 2" });
    await updateTaskStatus(conn, task.id, "complete");

    const pending = await listTasks(conn, { status: "pending" });
    expect(pending.length).toBe(1);
    expect(pending[0]!.name).toBe("Task 2");
  });

  test("update task status", async () => {
    const task = await createTask(conn, { name: "Task" });
    await updateTaskStatus(conn, task.id, "waiting", "needs clarification");

    const updated = await getTask(conn, task.id);
    expect(updated!.status).toBe("waiting");
    expect(updated!.waiting_reason).toBe("needs clarification");
  });

  test("get nonexistent task returns null", async () => {
    const task = await getTask(conn, "nonexistent-id");
    expect(task).toBeNull();
  });
});

describe("claimNextTask", () => {
  test("claims highest priority pending task", async () => {
    await createTask(conn, { name: "Low", priority: "low" });
    await createTask(conn, { name: "High", priority: "high" });

    const claimed = await claimNextTask(conn);
    expect(claimed).not.toBeNull();
    expect(claimed!.name).toBe("High");
    expect(claimed!.status).toBe("in_progress");
    expect(claimed!.claimed_by).toBe("daemon");
  });

  test("returns null when no tasks available", async () => {
    const claimed = await claimNextTask(conn);
    expect(claimed).toBeNull();
  });

  test("skips in_progress tasks", async () => {
    const task = await createTask(conn, { name: "Already claimed" });
    await updateTaskStatus(conn, task.id, "in_progress");

    const claimed = await claimNextTask(conn);
    expect(claimed).toBeNull();
  });

  test("skips blocked tasks", async () => {
    const blocker = await createTask(conn, { name: "Blocker" });
    await createTask(conn, {
      name: "Blocked",
      priority: "high",
      blocked_by: [blocker.id],
    });

    // Should not claim the blocked task even though it's higher priority
    const claimed = await claimNextTask(conn);
    expect(claimed).not.toBeNull();
    expect(claimed!.name).toBe("Blocker");
  });

  test("unblocks task when blocker completes", async () => {
    const blocker = await createTask(conn, { name: "Blocker" });
    await createTask(conn, {
      name: "Blocked",
      priority: "high",
      blocked_by: [blocker.id],
    });

    // Complete the blocker
    await updateTaskStatus(conn, blocker.id, "complete");

    // Now claim — should get the previously blocked task
    const claimed = await claimNextTask(conn);
    expect(claimed).not.toBeNull();
    expect(claimed!.name).toBe("Blocked");
  });
});
