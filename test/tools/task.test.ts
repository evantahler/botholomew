import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { getTasksDir, getTasksLockDir } from "../../src/constants.ts";
import {
  claimSpecificTask,
  createTask,
  getTask,
  updateTaskStatus,
} from "../../src/tasks/store.ts";
import { completeTaskTool } from "../../src/tools/task/complete.ts";
import { createTaskTool } from "../../src/tools/task/create.ts";
import { deleteTaskTool } from "../../src/tools/task/delete.ts";
import { failTaskTool } from "../../src/tools/task/fail.ts";
import { listTasksTool } from "../../src/tools/task/list.ts";
import { updateTaskTool } from "../../src/tools/task/update.ts";
import { viewTaskTool } from "../../src/tools/task/view.ts";
import { waitTaskTool } from "../../src/tools/task/wait.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-task-tools-"));
  await mkdir(getTasksDir(projectDir), { recursive: true });
  await mkdir(getTasksLockDir(projectDir), { recursive: true });
  ctx = {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function makeTask(
  overrides: Parameters<typeof createTaskTool.execute>[0],
): Promise<{ id: string; name: string }> {
  const r = await createTaskTool.execute(overrides, ctx);
  if (!r.id || !r.name) {
    throw new Error(`unexpected create_task error: ${r.message}`);
  }
  return { id: r.id, name: r.name };
}

// ── create_task ─────────────────────────────────────────────

describe("create_task", () => {
  test("creates a task with name only", async () => {
    const result = await createTaskTool.execute({ name: "Test task" }, ctx);
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("Test task");
    expect(result.message).toContain("Test task");
    expect(result.is_error).toBe(false);
  });

  test("creates a task with all fields", async () => {
    const created = await makeTask({
      name: "Full task",
      description: "Detailed description",
      priority: "high",
      context_paths: ["notes/a.md"],
    });
    const stored = await getTask(projectDir, created.id);
    expect(stored?.priority).toBe("high");
    expect(stored?.context_paths).toEqual(["notes/a.md"]);
  });

  test("creates a task with blocked_by", async () => {
    const first = await makeTask({ name: "First" });
    const second = await makeTask({ name: "Second", blocked_by: [first.id] });
    const stored = await getTask(projectDir, second.id);
    expect(stored?.blocked_by).toEqual([first.id]);
  });

  test("returns circular_dependency on a cycle", async () => {
    const a = await makeTask({ name: "A" });
    const b = await makeTask({ name: "B", blocked_by: [a.id] });
    const result = await createTaskTool.execute(
      { name: "C", blocked_by: [b.id] },
      ctx,
    );
    // No cycle yet; this one creates fine.
    expect(result.is_error).toBe(false);

    // Now retroactively try to make A depend on its descendant — that
    // closes a cycle. updateTask is the path that exposes the
    // CircularDependencyError to the tool.
    const cyclic = await updateTaskTool.execute(
      { id: a.id, blocked_by: [b.id] },
      ctx,
    );
    expect(cyclic.is_error).toBe(true);
    expect(cyclic.error_type).toBe("circular_dependency");
    expect(cyclic.next_action_hint).toBeTruthy();
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
    const created = await makeTask({ name: "Original" });
    const result = await updateTaskTool.execute(
      { id: created.id, name: "Renamed" },
      ctx,
    );
    expect(result.task).not.toBeNull();
    expect(result.task?.name).toBe("Renamed");
    expect(result.message).toContain("Renamed");
  });

  test("updates description and priority together", async () => {
    const created = await makeTask({ name: "Task" });
    const result = await updateTaskTool.execute(
      { id: created.id, description: "New desc", priority: "high" },
      ctx,
    );
    expect(result.task?.description).toBe("New desc");
    expect(result.task?.priority).toBe("high");
  });

  test("updates blocked_by", async () => {
    const a = await makeTask({ name: "A" });
    const b = await makeTask({ name: "B" });
    const result = await updateTaskTool.execute(
      { id: b.id, blocked_by: [a.id] },
      ctx,
    );
    expect(result.task?.blocked_by).toEqual([a.id]);
  });

  test("rejects update of non-pending task", async () => {
    const created = await makeTask({ name: "Task" });
    await updateTaskStatus(projectDir, created.id, "in_progress");
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
});

// ── delete_task ────────────────────────────────────────────

describe("delete_task", () => {
  test("deletes a pending task", async () => {
    const task = await createTask(projectDir, { name: "scratch" });
    const result = await deleteTaskTool.execute({ id: task.id }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.deleted_id).toBe(task.id);
    expect(result.message).toContain("scratch");
    expect(await getTask(projectDir, task.id)).toBeNull();
  });

  test("deletes a failed task", async () => {
    const task = await createTask(projectDir, { name: "broken" });
    await updateTaskStatus(projectDir, task.id, "failed", "boom");
    const result = await deleteTaskTool.execute({ id: task.id }, ctx);
    expect(result.is_error).toBe(false);
    expect(await getTask(projectDir, task.id)).toBeNull();
  });

  test("deletes a complete task", async () => {
    const task = await createTask(projectDir, { name: "done" });
    await updateTaskStatus(projectDir, task.id, "complete", null, "ok");
    const result = await deleteTaskTool.execute({ id: task.id }, ctx);
    expect(result.is_error).toBe(false);
    expect(await getTask(projectDir, task.id)).toBeNull();
  });

  test("deletes a waiting task", async () => {
    const task = await createTask(projectDir, { name: "paused" });
    await updateTaskStatus(projectDir, task.id, "waiting", "blocked on user");
    const result = await deleteTaskTool.execute({ id: task.id }, ctx);
    expect(result.is_error).toBe(false);
    expect(await getTask(projectDir, task.id)).toBeNull();
  });

  test("refuses to delete an in_progress task and names the worker", async () => {
    const task = await createTask(projectDir, { name: "running" });
    const claimed = await claimSpecificTask(projectDir, task.id, "worker-1");
    expect(claimed?.status).toBe("in_progress");

    const result = await deleteTaskTool.execute({ id: task.id }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.deleted_id).toBeNull();
    expect(result.message).toContain("in_progress");
    expect(result.message).toContain("worker-1");
    expect(result.message).toContain("botholomew task reset");
    expect(await getTask(projectDir, task.id)).not.toBeNull();
  });

  test("returns not-found error for unknown id", async () => {
    const result = await deleteTaskTool.execute({ id: "nonexistent" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.deleted_id).toBeNull();
    expect(result.message).toContain("not found");
  });
});

// ── list_tasks ────────────────────────────────────────────

describe("list_tasks", () => {
  test("returns empty list when no tasks", async () => {
    const result = await listTasksTool.execute({}, ctx);
    expect(result.tasks).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("returns all tasks newest first", async () => {
    await createTaskTool.execute({ name: "first" }, ctx);
    // Tiny gap so created_at differs and newest-first is meaningful.
    await new Promise((r) => setTimeout(r, 5));
    await createTaskTool.execute({ name: "second" }, ctx);
    const result = await listTasksTool.execute({}, ctx);
    expect(result.count).toBe(2);
    expect(result.tasks[0]?.name).toBe("second");
    expect(result.tasks[1]?.name).toBe("first");
  });

  test("filters by status", async () => {
    const a = await makeTask({ name: "a" });
    await makeTask({ name: "b" });
    await updateTaskStatus(projectDir, a.id, "complete", null, "done");
    const pending = await listTasksTool.execute({ status: "pending" }, ctx);
    expect(pending.count).toBe(1);
    expect(pending.tasks[0]?.name).toBe("b");
  });

  test("filters by priority", async () => {
    await createTaskTool.execute({ name: "lo", priority: "low" }, ctx);
    await createTaskTool.execute({ name: "hi", priority: "high" }, ctx);
    const high = await listTasksTool.execute({ priority: "high" }, ctx);
    expect(high.count).toBe(1);
    expect(high.tasks[0]?.name).toBe("hi");
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createTaskTool.execute({ name: `t-${i}` }, ctx);
      await new Promise((r) => setTimeout(r, 2));
    }
    const limited = await listTasksTool.execute({ limit: 2 }, ctx);
    expect(limited.count).toBe(2);
  });
});

// ── view_task ─────────────────────────────────────────────

describe("view_task", () => {
  test("returns task details", async () => {
    const created = await makeTask({
      name: "n",
      description: "body",
      priority: "high",
    });
    const view = await viewTaskTool.execute({ id: created.id }, ctx);
    expect(view.is_error).toBe(false);
    expect(view.task?.name).toBe("n");
    expect(view.task?.priority).toBe("high");
    expect(view.task?.description).toContain("body");
  });

  test("returns null for missing task", async () => {
    const view = await viewTaskTool.execute({ id: "nope" }, ctx);
    expect(view.is_error).toBe(true);
    expect(view.task).toBeNull();
  });

  test("includes blocked_by and context_paths", async () => {
    const a = await makeTask({ name: "a" });
    const b = await makeTask({
      name: "b",
      blocked_by: [a.id],
      context_paths: ["x.md"],
    });
    const view = await viewTaskTool.execute({ id: b.id }, ctx);
    expect(view.task?.blocked_by).toEqual([a.id]);
    expect(view.task?.context_paths).toEqual(["x.md"]);
  });
});

// ── complete_task / fail_task / wait_task (terminal stubs) ─────

describe("terminal task tools", () => {
  test("complete_task returns the summary in its message", async () => {
    const result = await completeTaskTool.execute({ summary: "All done" });
    expect(result.message).toContain("completed");
    expect(result.message).toContain("All done");
    expect(completeTaskTool.terminal).toBe(true);
  });

  test("fail_task returns the reason in its message", async () => {
    const result = await failTaskTool.execute({ reason: "Something broke" });
    expect(result.message).toContain("failed");
    expect(result.message).toContain("Something broke");
    expect(failTaskTool.terminal).toBe(true);
  });

  test("wait_task returns the reason in its message", async () => {
    const result = await waitTaskTool.execute({ reason: "Need human input" });
    expect(result.message).toContain("waiting");
    expect(result.message).toContain("Need human input");
    expect(waitTaskTool.terminal).toBe(true);
  });
});
