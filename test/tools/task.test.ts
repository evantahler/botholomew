import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import { completeTaskTool } from "../../src/tools/task/complete.ts";
import { createTaskTool } from "../../src/tools/task/create.ts";
import { failTaskTool } from "../../src/tools/task/fail.ts";
import { waitTaskTool } from "../../src/tools/task/wait.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
  ctx = { conn, projectDir: "/tmp/test", config: { ...DEFAULT_CONFIG } };
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
