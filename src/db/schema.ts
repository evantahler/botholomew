import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DuckDBConnection } from "./connection.ts";

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

export async function migrate(conn: DuckDBConnection): Promise<void> {
  // Create migrations tracking table
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name VARCHAR NOT NULL,
      applied_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  // Get already-applied migrations
  const result = await conn.runAndReadAll("SELECT id FROM _migrations");
  const applied = new Set(result.getRows().map((row) => Number(row[0])));

  // Run pending migrations in order
  for (const migration of loadMigrations()) {
    if (applied.has(migration.id)) continue;

    // Split on semicolons and run each statement individually
    const statements = migration.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await conn.run(statement);
    }

    await conn.run(
      `INSERT INTO _migrations (id, name) VALUES (${migration.id}, '${migration.name}')`,
    );
  }
}

export async function installVss(conn: DuckDBConnection): Promise<boolean> {
  try {
    await conn.run("INSTALL vss");
    await conn.run("LOAD vss");
    await conn.run(`
      CREATE INDEX IF NOT EXISTS embeddings_vss_idx
      ON embeddings USING HNSW (embedding)
      WITH (metric = 'cosine')
    `);
    return true;
  } catch {
    return false;
  }
}
