import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  claimSpecificTask,
  createTask,
  getTask,
  updateTaskStatus,
} from "../../src/db/tasks.ts";
import { completeTaskTool } from "../../src/tools/task/complete.ts";
import { createTaskTool } from "../../src/tools/task/create.ts";
import { deleteTaskTool } from "../../src/tools/task/delete.ts";
import { failTaskTool } from "../../src/tools/task/fail.ts";
import { updateTaskTool } from "../../src/tools/task/update.ts";
import { waitTaskTool } from "../../src/tools/task/wait.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let ctx: ToolContext;
let conn: DbConnection;

beforeEach(async () => {
  ({ ctx, conn } = await setupToolContext());
});

// ── create_task ─────────────────────────────────────────────

describe("create_task", () => {
  test("creates a task with name only", async () => {
    const result = await createTaskTool.execute({ name: "Test task" }, ctx);
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("Test task");
    expect(result.message).toContain("Test task");
  });

  test("creates a task with all fields", async () => {
    const result = await createTaskTool.execute(
      {
        name: "Full task",
        description: "Detailed description",
        priority: "high",
      },
      ctx,
    );
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("Full task");
  });

  test("creates a task with blocked_by", async () => {
    const first = await createTaskTool.execute({ name: "First" }, ctx);
    const second = await createTaskTool.execute(
      { name: "Second", blocked_by: [first.id] },
      ctx,
    );
    expect(second.id).toBeTruthy();
    expect(second.name).toBe("Second");
  });

  test("validates input schema rejects missing name", () => {
    const result = createTaskTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("validates input schema rejects invalid priority", () => {
    const result = createTaskTool.inputSchema.safeParse({
      name: "test",
      priority: "urgent",
    });
    expect(result.success).toBe(false);
  });
});

// ── update_task ────────────────────────────────────────────

describe("update_task", () => {
  test("updates name of a pending task", async () => {
    const created = await createTaskTool.execute({ name: "Original" }, ctx);
    const result = await updateTaskTool.execute(
      { id: created.id, name: "Renamed" },
      ctx,
    );
    expect(result.task).not.toBeNull();
    expect(result.task?.name).toBe("Renamed");
    expect(result.message).toContain("Renamed");
  });

  test("updates description and priority together", async () => {
    const created = await createTaskTool.execute({ name: "Task" }, ctx);
    const result = await updateTaskTool.execute(
      { id: created.id, description: "New desc", priority: "high" },
      ctx,
    );
    expect(result.task?.description).toBe("New desc");
    expect(result.task?.priority).toBe("high");
  });

  test("updates blocked_by", async () => {
    const a = await createTaskTool.execute({ name: "A" }, ctx);
    const b = await createTaskTool.execute({ name: "B" }, ctx);
    const result = await updateTaskTool.execute(
      { id: b.id, blocked_by: [a.id] },
      ctx,
    );
    expect(result.task?.blocked_by).toEqual([a.id]);
  });

  test("rejects update of non-pending task", async () => {
    const created = await createTaskTool.execute({ name: "Task" }, ctx);
    await updateTaskStatus(conn, created.id, "in_progress");
    const result = await updateTaskTool.execute(
      { id: created.id, name: "Nope" },
      ctx,
    );
    expect(result.task).toBeNull();
    expect(result.message).toContain("only pending");
  });

  test("returns error for non-existent task", async () => {
    const result = await updateTaskTool.execute(
      { id: "nonexistent", name: "Nope" },
      ctx,
    );
    expect(result.task).toBeNull();
    expect(result.message).toContain("not found");
  });

  test("validates input schema rejects missing id", () => {
    const result = updateTaskTool.inputSchema.safeParse({ name: "test" });
    expect(result.success).toBe(false);
  });

  test("validates input schema rejects invalid priority", () => {
    const result = updateTaskTool.inputSchema.safeParse({
      id: "abc",
      priority: "urgent",
    });
    expect(result.success).toBe(false);
  });
});

// ── delete_task ────────────────────────────────────────────

describe("delete_task", () => {
  test("deletes a pending task", async () => {
    const task = await createTask(conn, { name: "scratch" });

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(result.deleted_id).toBe(task.id);
    expect(result.message).toContain("scratch");
    expect(await getTask(conn, task.id)).toBeNull();
  });

  test("deletes a failed task", async () => {
    const task = await createTask(conn, { name: "broken" });
    await updateTaskStatus(conn, task.id, "failed", "boom");

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(await getTask(conn, task.id)).toBeNull();
  });

  test("deletes a complete task", async () => {
    const task = await createTask(conn, { name: "done" });
    await updateTaskStatus(conn, task.id, "complete", null, "ok");

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(await getTask(conn, task.id)).toBeNull();
  });

  test("deletes a waiting task", async () => {
    const task = await createTask(conn, { name: "paused" });
    await updateTaskStatus(conn, task.id, "waiting", "blocked on user");

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(await getTask(conn, task.id)).toBeNull();
  });

  test("refuses to delete an in_progress task and names the worker", async () => {
    const task = await createTask(conn, { name: "running" });
    const claimed = await claimSpecificTask(conn, task.id, "worker-1");
    expect(claimed?.status).toBe("in_progress");

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);

    expect(result.is_error).toBe(true);
    expect(result.deleted_id).toBeNull();
    expect(result.message).toContain("in_progress");
    expect(result.message).toContain("worker-1");
    expect(result.message).toContain("botholomew task reset");
    expect(await getTask(conn, task.id)).not.toBeNull();
  });

  test("returns not-found error for unknown id", async () => {
    const result = await deleteTaskTool.execute({ id: "nonexistent" }, ctx);

    expect(result.is_error).toBe(true);
    expect(result.deleted_id).toBeNull();
    expect(result.message).toContain("not found");
  });

  test("validates input schema rejects missing id", () => {
    const result = deleteTaskTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── complete_task ───────────────────────────────────────────

describe("complete_task", () => {
  test("returns completion message", async () => {
    const result = await completeTaskTool.execute({ summary: "All done" });
    expect(result.message).toContain("completed");
    expect(result.message).toContain("All done");
  });

  test("is marked as terminal", () => {
    expect(completeTaskTool.terminal).toBe(true);
  });
});

// ── fail_task ───────────────────────────────────────────────

describe("fail_task", () => {
  test("returns failure message", async () => {
    const result = await failTaskTool.execute({ reason: "Something broke" });
    expect(result.message).toContain("failed");
    expect(result.message).toContain("Something broke");
  });

  test("is marked as terminal", () => {
    expect(failTaskTool.terminal).toBe(true);
  });
});

// ── wait_task ───────────────────────────────────────────────

describe("wait_task", () => {
  test("returns waiting message", async () => {
    const result = await waitTaskTool.execute({ reason: "Need human input" });
    expect(result.message).toContain("waiting");
    expect(result.message).toContain("Need human input");
  });

  test("is marked as terminal", () => {
    expect(waitTaskTool.terminal).toBe(true);
  });
});
