import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.ts";
import type { DbConnection } from "./connection.ts";
import { rebuildSearchIndex } from "./embeddings.ts";

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const sqlDir = join(import.meta.dir, "sql");

function loadMigrations(): Migration[] {
  const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));

  const migrations = files.map((file) => {
    const match = file.match(/^(\d+)-(.+)\.sql$/);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);
    const id = match[1];
    const name = match[2];
    if (!id || !name) throw new Error(`Invalid migration filename: ${file}`);
    return {
      id: parseInt(id, 10),
      name,
      sql: readFileSync(join(sqlDir, file), "utf-8"),
    };
  });

  // Sort by numeric id so `12-` runs after `2-`, not between `11-` and `2-`.
  return migrations.sort((a, b) => a.id - b.id);
}

export async function migrate(db: DbConnection): Promise<void> {
  // Create migrations tracking table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (current_timestamp::VARCHAR)
    )
  `);

  // Get already-applied migrations
  const rows = await db.queryAll<{ id: number }>("SELECT id FROM _migrations");
  const applied = new Set(rows.map((row) => row.id));

  // Run pending migrations in order
  const pending = loadMigrations().filter((m) => !applied.has(m.id));
  if (pending.length > 0) {
    logger.info(
      `applying ${pending.length} migration${pending.length === 1 ? "" : "s"}`,
    );
  }

  let appliedAny = false;
  for (const migration of pending) {
    logger.info(`  ${migration.id}. ${migration.name}`);

    // Split on semicolons and run each statement individually
    const statements = migration.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await db.exec(statement);
    }

    await db.queryRun(
      "INSERT INTO _migrations (id, name) VALUES (?1, ?2)",
      migration.id,
      migration.name,
    );
    appliedAny = true;
  }

  // Flush the WAL so the next open has no schema entries to replay. DuckDB's
  // WAL replay of ALTER TABLE re-binds all column defaults on the target
  // table, and our CREATE TABLE defaults use `current_timestamp::VARCHAR` —
  // which cannot be resolved during replay (no default database attached yet),
  // crashing the process on reopen.
  if (appliedAny) {
    await db.exec("CHECKPOINT");
  }

  // Ensure the FTS index exists. Migration 18 drops it (it can't recreate it
  // in the same SQL run without DuckDB rejecting the dependency commit), and
  // fresh DBs need it created at least once. `overwrite = 1` makes this
  // idempotent for DBs that already have a healthy FTS index.
  await rebuildSearchIndex(db);
}
