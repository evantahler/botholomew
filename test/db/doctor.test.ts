/**
 * `botholomew db doctor` is the only safety-net we have when DuckDB's
 * primary-key index falls out of sync with row data. probeTable spawns a
 * child Bun process so a corrupt-index panic doesn't kill the doctor
 * itself; isPidAlive backs the worker reaper.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDb } from "../../src/db/connection.ts";
import {
  isPidAlive,
  PROBE_TABLES,
  probeAllTables,
  probeTable,
} from "../../src/db/doctor.ts";
import { migrate } from "../../src/db/schema.ts";

let dbPath: string;
let dbDir: string;

beforeEach(async () => {
  dbDir = await mkdtemp(join(tmpdir(), "both-doctor-"));
  dbPath = join(dbDir, "index.duckdb");
});

afterEach(async () => {
  await rm(dbDir, { recursive: true, force: true });
});

describe("probeTable", () => {
  test("reports 'empty' for an empty table", async () => {
    await withDb(dbPath, (conn) => migrate(conn));
    const r = await probeTable(dbPath, "context_index", "path");
    expect(r.status).toBe("empty");
    expect(r.table).toBe("context_index");
  }, 30_000);

  test("reports 'missing' for an unknown table", async () => {
    await withDb(dbPath, (conn) => migrate(conn));
    const r = await probeTable(dbPath, "no_such_table", "id");
    expect(r.status).toBe("missing");
  }, 30_000);

  test("reports 'ok' for a populated, healthy table", async () => {
    await withDb(dbPath, async (conn) => {
      await migrate(conn);
      await conn.queryRun(
        `INSERT INTO context_index
           (path, chunk_index, content_hash, chunk_content, embedding,
            mtime_ms, size_bytes)
         VALUES ('x.md', 0, 'deadbeef', 'hello world', NULL, 0, 5)`,
      );
    });
    const r = await probeTable(dbPath, "context_index", "path");
    expect(r.status).toBe("ok");
  }, 30_000);
});

describe("probeAllTables", () => {
  test("returns one ProbeResult per table in PROBE_TABLES on a fresh DB", async () => {
    await withDb(dbPath, (conn) => migrate(conn));
    const results = await probeAllTables(dbPath);
    expect(results).toHaveLength(PROBE_TABLES.length);
    const names = new Set(results.map((r) => r.table));
    for (const t of PROBE_TABLES) expect(names.has(t.name)).toBe(true);
  }, 60_000);
});

describe("isPidAlive", () => {
  test("returns true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("returns false for pid 0 (sentinel)", () => {
    expect(isPidAlive(0)).toBe(false);
  });

  test("returns false for a pid that was never assigned", () => {
    // 2^31 - 1 is well beyond any real pid the OS will hand out.
    expect(isPidAlive(2_147_483_640)).toBe(false);
  });
});
