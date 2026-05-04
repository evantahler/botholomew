import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withDb } from "./connection.ts";

/**
 * Tables we probe for primary-key index integrity. Every user table has a
 * single-column PK that we exercise with a self-update (SET pk = pk WHERE
 * pk = ...). DuckDB still walks the index for the SET, which surfaces
 * "Failed to delete all rows from index" FATAL errors when the index is
 * out of sync with the row data. `_migrations` is excluded — it is small,
 * append-only, and rebuilding it would defeat its purpose.
 */
export const PROBE_TABLES: ReadonlyArray<{ name: string; pk: string }> = [
  { name: "workers", pk: "id" },
  { name: "threads", pk: "id" },
  { name: "interactions", pk: "id" },
  { name: "context_index", pk: "path" },
];

export type ProbeStatus = "ok" | "empty" | "missing" | "corrupt";

export interface ProbeResult {
  table: string;
  status: ProbeStatus;
  /** Detail message when status is corrupt or missing. */
  message?: string;
}

/**
 * Probe a single table for index corruption by spawning a child Bun
 * process. We use a child process because a corrupt PK index in DuckDB
 * surfaces as a Bun panic (a C++ exception that unwinds past the NAPI
 * boundary), which would kill the doctor itself. The child reports its
 * verdict on stdout and exits.
 *
 * Uses absolute import path resolved against this file so the spawned
 * Bun process picks up the same `@duckdb/node-api` install.
 */
export async function probeTable(
  dbPath: string,
  table: string,
  pk: string,
): Promise<ProbeResult> {
  const script = `
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const dbPath = ${JSON.stringify(dbPath)};
    const table = ${JSON.stringify(table)};
    const pk = ${JSON.stringify(pk)};
    let inst;
    try {
      inst = await DuckDBInstance.create(dbPath);
    } catch (e) {
      process.stdout.write("MISSING:" + (e?.message ?? String(e)));
      process.exit(0);
    }
    const c = await inst.connect();
    try {
      const r = await c.runAndReadAll(\`SELECT \${pk} FROM \${table} LIMIT 1\`);
      if (r.getRows().length === 0) {
        process.stdout.write("EMPTY");
        process.exit(0);
      }
    } catch (e) {
      const msg = String(e?.message ?? e);
      // Table doesn't exist yet (e.g., schema older than this doctor) — not
      // a corruption signal, just skip it.
      if (msg.includes("does not exist") || msg.includes("Catalog Error")) {
        process.stdout.write("MISSING:" + msg);
        process.exit(0);
      }
      process.stdout.write("CORRUPT:" + msg);
      process.exit(2);
    }
    try {
      await c.run(\`UPDATE \${table} SET \${pk} = \${pk} WHERE \${pk} = (SELECT \${pk} FROM \${table} LIMIT 1)\`);
      process.stdout.write("OK");
      process.exit(0);
    } catch (e) {
      process.stdout.write("CORRUPT:" + (e?.message ?? String(e)));
      process.exit(2);
    }
  `;

  // Discard the child's stderr. When the probe panics, Bun writes a multi-
  // line crash banner there which would otherwise spill into our table
  // output via the fallback message. The exit code alone tells us what we
  // need to know.
  const proc = Bun.spawn(["bun", "-e", script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  // Bun panic: process killed by SIGTRAP / non-zero exit with no stdout
  // verdict. Treat any unrecognized exit as corruption — better to flag
  // for repair than to silently miss a problem.
  if (stdout.startsWith("OK")) return { table, status: "ok" };
  if (stdout.startsWith("EMPTY")) return { table, status: "empty" };
  if (stdout.startsWith("MISSING:")) {
    return {
      table,
      status: "missing",
      message: firstLine(stdout.slice("MISSING:".length)),
    };
  }
  if (stdout.startsWith("CORRUPT:")) {
    return {
      table,
      status: "corrupt",
      message: firstLine(stdout.slice("CORRUPT:".length)),
    };
  }
  return {
    table,
    status: "corrupt",
    message: `child exited with code ${exitCode} (likely native panic)`,
  };
}

/**
 * Run probes for every known table. Sequential rather than parallel so we
 * cooperate with DuckDB's per-process file lock and don't multiply the
 * blast radius of a panic.
 */
export async function probeAllTables(dbPath: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const { name, pk } of PROBE_TABLES) {
    results.push(await probeTable(dbPath, name, pk));
  }
  return results;
}

export interface RepairResult {
  backupDbPath: string;
  exportDir: string;
  durationMs: number;
}

/**
 * Repair `dbPath` by exporting its contents and importing into a fresh
 * file. EXPORT DATABASE reads via sequential scans, not via PK indexes,
 * so it survives the kind of index corruption that breaks UPDATE/DELETE.
 * IMPORT DATABASE rebuilds every index from the data, which restores
 * write integrity.
 *
 * Steps:
 *   1. CHECKPOINT (best-effort) to flush WAL.
 *   2. EXPORT DATABASE to `<dotDir>/.export-<timestamp>`.
 *   3. Move `data.duckdb` (and `.wal`) to `data.duckdb.bak-<timestamp>`.
 *   4. Open a fresh DB at the original path and IMPORT DATABASE.
 *   5. Leave the export dir on disk — cheap insurance if step 4 ever fails
 *      mid-way; cleanup on the next successful run.
 *
 * The caller is responsible for ensuring no other process holds the DB
 * (no running workers, no chat session, no TUI).
 */
export async function repairDatabase(dbPath: string): Promise<RepairResult> {
  const start = Date.now();
  const dotDir = dirname(dbPath);
  await mkdir(dotDir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  const exportDir = join(dotDir, `.export-${stamp}`);
  const backupDbPath = `${dbPath}.bak-${stamp}`;
  const walPath = `${dbPath}.wal`;
  const backupWalPath = `${backupDbPath}.wal`;

  await withDb(dbPath, async (conn) => {
    try {
      await conn.exec("CHECKPOINT");
    } catch {
      // CHECKPOINT can fail on an already-invalidated DB; the EXPORT
      // below is what actually matters.
    }
    await conn.exec(`EXPORT DATABASE '${exportDir.replace(/'/g, "''")}'`);
  });

  await rename(dbPath, backupDbPath);
  if (await pathExists(walPath)) {
    await rename(walPath, backupWalPath);
  }

  await withDb(dbPath, async (conn) => {
    await conn.exec(`IMPORT DATABASE '${exportDir.replace(/'/g, "''")}'`);
  });

  // Best-effort cleanup of the export dir. Leave it on failure — the user
  // still has data.duckdb (rebuilt) and the backup.
  try {
    await rm(exportDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return {
    backupDbPath,
    exportDir,
    durationMs: Date.now() - start,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function firstLine(s: string): string {
  const trimmed = s.trim();
  const nl = trimmed.indexOf("\n");
  return nl === -1 ? trimmed : trimmed.slice(0, nl);
}

/**
 * Send signal 0 to test whether `pid` corresponds to a live process. Returns
 * false on ESRCH (no such process) and on any other error (including EPERM,
 * which we conservatively treat as "not ours, not relevant"). Used by the
 * doctor's safety gate to distinguish workers actually running from rows
 * that say `status = 'running'` because the worker crashed before flipping
 * its row to `stopped` or `dead`.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
