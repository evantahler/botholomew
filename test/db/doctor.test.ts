import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConnection } from "../../src/db/connection.ts";
import {
  PROBE_TABLES,
  probeAllTables,
  probeTable,
  repairDatabase,
} from "../../src/db/doctor.ts";
import { migrate } from "../../src/db/schema.ts";
import { registerWorker } from "../../src/db/workers.ts";

let dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
  dirs = [];
});

async function tempDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "doctor-"));
  dirs.push(dir);
  const dbPath = join(dir, "data.duckdb");
  const conn = await getConnection(dbPath);
  await migrate(conn);
  conn.close();
  return dbPath;
}

function sampleWorker(id: string, pid = 12345) {
  return {
    id,
    pid,
    hostname: "test-host",
    mode: "once" as const,
  };
}

describe("probeTable", () => {
  test("reports 'empty' for an empty table", async () => {
    const dbPath = await tempDb();
    const result = await probeTable(dbPath, "workers", "id");
    expect(result.status).toBe("empty");
    expect(result.table).toBe("workers");
  });

  test("reports 'ok' for a populated, healthy table", async () => {
    const dbPath = await tempDb();
    const conn = await getConnection(dbPath);
    await registerWorker(conn, sampleWorker("w-probe"));
    conn.close();

    const result = await probeTable(dbPath, "workers", "id");
    expect(result.status).toBe("ok");
  });

  test("reports 'missing' for an unknown table", async () => {
    const dbPath = await tempDb();
    const result = await probeTable(dbPath, "no_such_table", "id");
    expect(result.status).toBe("missing");
  });
});

describe("probeAllTables", () => {
  test("returns one result per registered table on a fresh DB", async () => {
    const dbPath = await tempDb();
    const results = await probeAllTables(dbPath);
    expect(results.map((r) => r.table)).toEqual(
      PROBE_TABLES.map((t) => t.name),
    );
    // Empty DB: no table is corrupt.
    expect(results.every((r) => r.status !== "corrupt")).toBe(true);
  });
});

describe("repairDatabase", () => {
  test("preserves data through an EXPORT/IMPORT round-trip", async () => {
    const dbPath = await tempDb();

    const conn1 = await getConnection(dbPath);
    await registerWorker(conn1, sampleWorker("w-1", 1));
    await registerWorker(conn1, sampleWorker("w-2", 2));
    await registerWorker(conn1, sampleWorker("w-3", 3));
    conn1.close();

    const result = await repairDatabase(dbPath);
    expect(result.backupDbPath).toMatch(/\.bak-/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const conn2 = await getConnection(dbPath);
    const row = await conn2.queryGet<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workers",
    );
    conn2.close();
    expect(row?.n).toBe(3);
  });

  test("leaves a working DB after repair (writes still succeed)", async () => {
    const dbPath = await tempDb();
    await repairDatabase(dbPath);

    const conn = await getConnection(dbPath);
    await registerWorker(conn, sampleWorker("w-after"));
    const row = await conn.queryGet<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workers",
    );
    conn.close();
    expect(row?.n).toBe(1);
  });
});
