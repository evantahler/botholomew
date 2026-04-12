import { describe, expect, test } from "bun:test";
import { getMemoryConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";

describe("schema migrations", () => {
  test("migrate runs cleanly on a fresh database", async () => {
    const conn = await getMemoryConnection();
    await migrate(conn);

    // Verify all tables exist
    const result = await conn.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    const tables = result.getRows().map((row) => String(row[0]));

    expect(tables).toContain("_migrations");
    expect(tables).toContain("tasks");
    expect(tables).toContain("schedules");
    expect(tables).toContain("context_items");
    expect(tables).toContain("embeddings");
    expect(tables).toContain("threads");
    expect(tables).toContain("interactions");
    expect(tables).toContain("daemon_state");
  });

  test("migrate is idempotent", async () => {
    const conn = await getMemoryConnection();
    await migrate(conn);
    await migrate(conn); // should not throw

    const result = await conn.runAndReadAll("SELECT COUNT(*) FROM _migrations");
    const count = Number(result.getRows()[0]![0]);
    expect(count).toBe(3);
  });

  test("tasks table has correct columns", async () => {
    const conn = await getMemoryConnection();
    await migrate(conn);

    const result = await conn.runAndReadAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' ORDER BY ordinal_position",
    );
    const columns = result.getRows().map((row) => String(row[0]));

    expect(columns).toEqual([
      "id",
      "name",
      "description",
      "priority",
      "status",
      "waiting_reason",
      "claimed_by",
      "claimed_at",
      "blocked_by",
      "context_ids",
      "created_at",
      "updated_at",
    ]);
  });

  test("threads table has correct columns", async () => {
    const conn = await getMemoryConnection();
    await migrate(conn);

    const result = await conn.runAndReadAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'threads' ORDER BY ordinal_position",
    );
    const columns = result.getRows().map((row) => String(row[0]));

    expect(columns).toEqual([
      "id",
      "type",
      "task_id",
      "title",
      "started_at",
      "ended_at",
      "metadata",
    ]);
  });

  test("interactions table has correct columns", async () => {
    const conn = await getMemoryConnection();
    await migrate(conn);

    const result = await conn.runAndReadAll(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'interactions' ORDER BY ordinal_position",
    );
    const columns = result.getRows().map((row) => String(row[0]));

    expect(columns).toEqual([
      "id",
      "thread_id",
      "sequence",
      "role",
      "kind",
      "content",
      "tool_name",
      "tool_input",
      "duration_ms",
      "token_count",
      "created_at",
    ]);
  });
});
