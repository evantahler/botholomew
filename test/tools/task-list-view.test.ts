import { beforeEach, describe, expect, test } from "bun:test";
import { createTask } from "../../src/db/tasks.ts";
import { listTasksTool } from "../../src/tools/task/list.ts";
import { viewTaskTool } from "../../src/tools/task/view.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { setupToolContext } from "../helpers.ts";

let ctx: ToolContext;

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
});

// ── list_tasks ────────────────────────────────────────────

describe("list_tasks", () => {
  test("returns empty list when no tasks", async () => {
    const result = await listTasksTool.execute({}, ctx);
    expect(result.tasks).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("returns all tasks", async () => {
    await createTask(ctx.conn, { name: "Task A" });
    await createTask(ctx.conn, { name: "Task B" });
    const result = await listTasksTool.execute({}, ctx);
    expect(result.count).toBe(2);
    expect(result.tasks.map((t) => t.name)).toEqual(["Task A", "Task B"]);
  });

  test("filters by status", async () => {
    await createTask(ctx.conn, { name: "Pending" });
    const result = await listTasksTool.execute({ status: "pending" }, ctx);
    expect(result.count).toBe(1);
    expect(result.tasks[0]?.status).toBe("pending");
  });

  test("filters by priority", async () => {
    await createTask(ctx.conn, { name: "Low", priority: "low" });
    await createTask(ctx.conn, { name: "High", priority: "high" });
    const result = await listTasksTool.execute({ priority: "high" }, ctx);
    expect(result.count).toBe(1);
    expect(result.tasks[0]?.name).toBe("High");
  });

  test("respects limit", async () => {
    await createTask(ctx.conn, { name: "A" });
    await createTask(ctx.conn, { name: "B" });
    await createTask(ctx.conn, { name: "C" });
    const result = await listTasksTool.execute({ limit: 2 }, ctx);
    expect(result.count).toBe(2);
  });
});

// ── view_task ─────────────────────────────────────────────

describe("view_task", () => {
  test("returns task details", async () => {
    const task = await createTask(ctx.conn, {
      name: "My Task",
      description: "Do stuff",
      priority: "high",
    });
    const result = await viewTaskTool.execute({ id: task.id }, ctx);
    expect(result.task).not.toBeNull();
    expect(result.task?.name).toBe("My Task");
    expect(result.task?.description).toBe("Do stuff");
    expect(result.task?.priority).toBe("high");
    expect(result.task?.status).toBe("pending");
  });

  test("returns null for missing task", async () => {
    const result = await viewTaskTool.execute({ id: "nonexistent" }, ctx);
    expect(result.task).toBeNull();
  });

  test("includes blocked_by and context_ids", async () => {
    const dep = await createTask(ctx.conn, { name: "Dep" });
    const task = await createTask(ctx.conn, {
      name: "Blocked",
      blocked_by: [dep.id],
    });
    const result = await viewTaskTool.execute({ id: task.id }, ctx);
    expect(result.task?.blocked_by).toEqual([dep.id]);
  });
});
