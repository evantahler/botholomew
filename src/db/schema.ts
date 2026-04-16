import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "./connection.ts";

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const sqlDir = join(import.meta.dir, "sql");

function loadMigrations(): Migration[] {
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((file) => {
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
  for (const migration of loadMigrations()) {
    if (applied.has(migration.id)) continue;

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
  }
}
