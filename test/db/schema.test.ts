import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConnection, withDb } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";

const EXPECTED_TABLES = [
  "_migrations",
  "context_index",
  "interactions",
  "threads",
  "workers",
];

describe("schema migrations", () => {
  test("migrate runs cleanly on a fresh database", async () => {
    const db = await getConnection();
    await migrate(db);

    const rows = await db.queryAll<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
    );
    const tables = rows.map((row) => row.table_name).sort();

    for (const expected of EXPECTED_TABLES) {
      expect(tables).toContain(expected);
    }
    // Tables we explicitly retired: tasks/schedules → files on disk;
    // context_items/embeddings → replaced by context_index; daemon_state → unused.
    expect(tables).not.toContain("tasks");
    expect(tables).not.toContain("schedules");
    expect(tables).not.toContain("context_items");
    expect(tables).not.toContain("embeddings");
    expect(tables).not.toContain("daemon_state");

    db.close();
  });

  test("reopening a freshly migrated file-backed DB does not crash on WAL replay", async () => {
    // Regression: an early migration's ALTER TABLE used to leave an entry
    // in the WAL that re-bound `current_timestamp` defaults at replay time,
    // crashing the process. `migrate()` CHECKPOINTs after applying.
    const dir = await mkdtemp(join(tmpdir(), "both-schema-wal-"));
    const dbPath = join(dir, "test.duckdb");
    try {
      await withDb(dbPath, async (conn) => {
        await migrate(conn);
      });

      // Re-open; this would crash before the fix.
      await withDb(dbPath, async (conn) => {
        await migrate(conn);
        const row = await conn.queryGet<{ count: number }>(
          "SELECT COUNT(*) AS count FROM context_index",
        );
        expect(row?.count).toBe(0);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("migrate is idempotent", async () => {
    const db = await getConnection();
    await migrate(db);
    const before = (await db.queryGet(
      "SELECT COUNT(*) AS count FROM _migrations",
    )) as { count: number };
    await migrate(db);
    const after = (await db.queryGet(
      "SELECT COUNT(*) AS count FROM _migrations",
    )) as { count: number };
    expect(after.count).toBe(before.count);
    expect(before.count).toBeGreaterThan(0);
    db.close();
  });

  test("context_index has (path, chunk_index) primary key", async () => {
    const db = await getConnection();
    await migrate(db);

    await db.queryRun(
      `INSERT INTO context_index (path, chunk_index, content_hash, chunk_content, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      "notes/x.md",
      0,
      "hash1",
      "first chunk",
      1,
      11,
    );

    await expect(
      db.queryRun(
        `INSERT INTO context_index (path, chunk_index, content_hash, chunk_content, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        "notes/x.md",
        0,
        "hash2",
        "duplicate",
        1,
        9,
      ),
    ).rejects.toThrow();

    // Same path, different chunk_index is fine.
    await db.queryRun(
      `INSERT INTO context_index (path, chunk_index, content_hash, chunk_content, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      "notes/x.md",
      1,
      "hash1",
      "second chunk",
      1,
      12,
    );

    db.close();
  });
});
