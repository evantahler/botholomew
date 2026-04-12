import type { DuckDBConnection } from "./connection.ts";

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "create_core_tables",
    sql: `
      CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
      CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'failed', 'complete', 'waiting');

      CREATE TABLE tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        name VARCHAR NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority task_priority NOT NULL DEFAULT 'medium',
        status task_status NOT NULL DEFAULT 'pending',
        waiting_reason TEXT,
        claimed_by VARCHAR,
        claimed_at TIMESTAMP,
        blocked_by VARCHAR[],
        context_ids VARCHAR[],
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      );

      CREATE TABLE schedules (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        name VARCHAR NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        frequency VARCHAR NOT NULL,
        last_run_at TIMESTAMP,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      );

      CREATE TABLE context_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        title VARCHAR NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT,
        content_blob BLOB,
        mime_type VARCHAR NOT NULL DEFAULT 'text/plain',
        is_textual BOOLEAN NOT NULL DEFAULT true,
        source_path VARCHAR,
        context_path VARCHAR NOT NULL,
        indexed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      );

      CREATE TABLE embeddings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        context_item_id VARCHAR NOT NULL REFERENCES context_items(id),
        chunk_index INTEGER NOT NULL,
        chunk_content TEXT,
        title VARCHAR NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source_path VARCHAR,
        embedding FLOAT[384],
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE(context_item_id, chunk_index)
      );
    `,
  },
  {
    id: 2,
    name: "create_logging_tables",
    sql: `
      CREATE TYPE thread_type AS ENUM ('daemon_tick', 'chat_session');
      CREATE TYPE interaction_role AS ENUM ('user', 'assistant', 'system', 'tool');
      CREATE TYPE interaction_kind AS ENUM (
        'message',
        'thinking',
        'tool_use',
        'tool_result',
        'context_update',
        'status_change'
      );

      CREATE TABLE threads (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        type thread_type NOT NULL,
        task_id VARCHAR,
        title VARCHAR NOT NULL DEFAULT '',
        started_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        ended_at TIMESTAMP,
        metadata TEXT
      );

      CREATE TABLE interactions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
        thread_id VARCHAR NOT NULL REFERENCES threads(id),
        sequence INTEGER NOT NULL,
        role interaction_role NOT NULL,
        kind interaction_kind NOT NULL,
        content TEXT NOT NULL,
        tool_name VARCHAR,
        tool_input TEXT,
        duration_ms INTEGER,
        token_count INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE(thread_id, sequence)
      );
    `,
  },
  {
    id: 3,
    name: "create_daemon_state",
    sql: `
      CREATE TABLE daemon_state (
        key VARCHAR PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      );
    `,
  },
];

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
  for (const migration of migrations) {
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
