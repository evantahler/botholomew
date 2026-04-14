import { describe, expect, test } from "bun:test";
import { getConnection } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";

describe("schema migrations", () => {
  test("migrate runs cleanly on a fresh database", () => {
    const db = getConnection(":memory:");
    migrate(db);

    // Verify all tables exist
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tables = rows.map((row) => row.name);

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

  test("migrate is idempotent", () => {
    const db = getConnection(":memory:");
    migrate(db);
    migrate(db); // should not throw

    const row = db.query("SELECT COUNT(*) AS count FROM _migrations").get() as {
      count: number;
    };
    expect(row.count).toBe(4);

    db.close();
  });

  test("tasks table has correct columns", () => {
    const db = getConnection(":memory:");
    migrate(db);

    const rows = db.query("PRAGMA table_info('tasks')").all() as {
      name: string;
    }[];
    const columns = rows.map((row) => row.name);

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

  test("threads table has correct columns", () => {
    const db = getConnection(":memory:");
    migrate(db);

    const rows = db.query("PRAGMA table_info('threads')").all() as {
      name: string;
    }[];
    const columns = rows.map((row) => row.name);

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

  test("interactions table has correct columns", () => {
    const db = getConnection(":memory:");
    migrate(db);

    const rows = db.query("PRAGMA table_info('interactions')").all() as {
      name: string;
    }[];
    const columns = rows.map((row) => row.name);

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
