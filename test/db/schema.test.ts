import { describe, expect, test } from "bun:test";
import { getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";

describe("schema migrations", () => {
  test("migrate runs cleanly on a fresh database", async () => {
    const db = await getConnection();
    await migrate(db);

    // Verify all tables exist
    const rows = await db.queryAll<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    const tables = rows.map((row) => row.table_name);

    expect(tables).toContain("_migrations");
    expect(tables).toContain("tasks");
    expect(tables).toContain("schedules");
    expect(tables).toContain("context_items");
    expect(tables).toContain("embeddings");
    expect(tables).toContain("threads");
    expect(tables).toContain("interactions");
    expect(tables).toContain("daemon_state");

    db.close();
  });

  test("migrate is idempotent", async () => {
    const db = await getConnection();
    await migrate(db);
    await migrate(db); // should not throw

    const row = (await db.queryGet(
      "SELECT COUNT(*) AS count FROM _migrations",
    )) as {
      count: number;
    };
    expect(row.count).toBe(7);

    db.close();
  });

  test("tasks table has correct columns", async () => {
    const db = await getConnection();
    await migrate(db);

    const rows = await db.queryAll<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND table_schema = 'main' ORDER BY ordinal_position",
    );
    const columns = rows.map((row) => row.column_name);

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

    db.close();
  });

  test("threads table has correct columns", async () => {
    const db = await getConnection();
    await migrate(db);

    const rows = await db.queryAll<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'threads' AND table_schema = 'main' ORDER BY ordinal_position",
    );
    const columns = rows.map((row) => row.column_name);

    expect(columns).toEqual([
      "id",
      "type",
      "task_id",
      "title",
      "started_at",
      "ended_at",
      "metadata",
    ]);

    db.close();
  });

  test("interactions table has correct columns", async () => {
    const db = await getConnection();
    await migrate(db);

    const rows = await db.queryAll<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'interactions' AND table_schema = 'main' ORDER BY ordinal_position",
    );
    const columns = rows.map((row) => row.column_name);

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

    db.close();
  });
});
