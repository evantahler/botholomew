import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  claimNextTask,
  createTask,
  getTask,
  resetTask,
  updateTaskStatus,
} from "../../src/db/tasks.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("task output", () => {
  test("newly created task has null output", async () => {
    const task = await createTask(conn, { name: "Test" });
    expect(task.output).toBeNull();
  });

  test("updateTaskStatus stores output on complete", async () => {
    const task = await createTask(conn, { name: "Test" });
    await updateTaskStatus(
      conn,
      task.id,
      "complete",
      "Done",
      "Found 3 relevant documents",
    );

    const updated = await getTask(conn, task.id);
    expect(updated?.status).toBe("complete");
    expect(updated?.output).toBe("Found 3 relevant documents");
  });

  test("updateTaskStatus stores output on failed", async () => {
    const task = await createTask(conn, { name: "Test" });
    await updateTaskStatus(
      conn,
      task.id,
      "failed",
      "API error",
      "API returned 500",
    );

    const updated = await getTask(conn, task.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.output).toBe("API returned 500");
  });

  test("updateTaskStatus without output leaves it null", async () => {
    const task = await createTask(conn, { name: "Test" });
    await updateTaskStatus(conn, task.id, "waiting", "Need input");

    const updated = await getTask(conn, task.id);
    expect(updated?.output).toBeNull();
  });

  test("resetTask clears output", async () => {
    const task = await createTask(conn, { name: "Test" });
    await updateTaskStatus(
      conn,
      task.id,
      "complete",
      "Done",
      "Some results here",
    );

    const completed = await getTask(conn, task.id);
    expect(completed?.output).toBe("Some results here");

    // Reset needs in_progress status first
    await updateTaskStatus(conn, task.id, "in_progress");
    const reset = await resetTask(conn, task.id);
    expect(reset?.status).toBe("pending");
    expect(reset?.output).toBeNull();
  });

  test("completed predecessor output is accessible to downstream task", async () => {
    const taskA = await createTask(conn, { name: "Research" });
    await updateTaskStatus(
      conn,
      taskA.id,
      "complete",
      "Done",
      "Found key insight: X leads to Y",
    );

    const taskB = await createTask(conn, {
      name: "Write report",
      blocked_by: [taskA.id],
    });

    // Verify taskB's predecessor has output
    const blockerId = taskB.blocked_by[0];
    expect(blockerId).toBeDefined();
    const predecessor = await getTask(conn, blockerId as string);
    expect(predecessor?.output).toBe("Found key insight: X leads to Y");
    expect(predecessor?.status).toBe("complete");

    // Verify taskB can be claimed (predecessor is complete)
    // First set taskB to pending state (it already is)
    const claimed = await claimNextTask(conn);
    expect(claimed?.id).toBe(taskB.id);
  });
});
