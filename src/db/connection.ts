import { DuckDBInstance } from "@duckdb/node-api";

type SqlParam = string | number | boolean | null | number[];

/**
 * Thin wrapper around DuckDB connection that provides a familiar
 * query interface similar to bun:sqlite. Automatically translates
 * ?N parameter placeholders to $N for DuckDB compatibility.
 */
export class DbConnection {
  // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
  private conn: any;
  // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
  private instance: any;

  // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
  constructor(conn: any, instance: any) {
    this.conn = conn;
    this.instance = instance;
  }

  /** Execute raw SQL with no return value. */
  async exec(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  /** Run a query and return the first row, or null. */
  async queryGet<T = Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): Promise<T | null> {
    const translated = translateParams(sql);
    const result = await this.conn.runAndReadAll(
      translated,
      flattenParams(params),
    );
    const rows = await result.getRowObjectsJS();
    return (rows[0] ? convertRow(rows[0]) : null) as T | null;
  }

  /** Run a query and return all rows. */
  async queryAll<T = Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): Promise<T[]> {
    const translated = translateParams(sql);
    const result = await this.conn.runAndReadAll(
      translated,
      flattenParams(params),
    );
    const rows = await result.getRowObjectsJS();
    return rows.map(convertRow) as T[];
  }

  /** Run a mutation and return the number of changed rows. */
  async queryRun(
    sql: string,
    ...params: SqlParam[]
  ): Promise<{ changes: number }> {
    const translated = translateParams(sql);
    const result = await this.conn.run(translated, flattenParams(params));
    return { changes: result.rowsChanged };
  }

  /** Close the connection and dispose of the instance. */
  close(): void {
    this.conn.disconnectSync();
    this.instance.closeSync();
  }
}

/**
 * Convert DuckDB row values to JS-friendly types:
 * - BigInt → number (safe for counts and IDs)
 * - Date → ISO string (matches our TEXT column convention)
 * - Nested arrays/objects are left as-is
 */
// biome-ignore lint/suspicious/noExplicitAny: row values are dynamic
function convertRow(row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === "bigint") {
      out[key] = Number(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** Translate ?N placeholders to $N for DuckDB. */
function translateParams(sql: string): string {
  return sql.replace(/\?(\d+)/g, "$$$1");
}

/** Flatten params, converting number[] to JSON strings for vector columns. */
function flattenParams(params: SqlParam[]): SqlParam[] {
  return params.map((p) => (Array.isArray(p) ? JSON.stringify(p) : p));
}

export async function getConnection(dbPath?: string): Promise<DbConnection> {
  const instance = await DuckDBInstance.create(dbPath ?? ":memory:");
  const conn = await instance.connect();

  // Load VSS extension for vector similarity search
  await conn.run("INSTALL vss; LOAD vss;");
  // Enable HNSW index persistence for file-backed databases
  await conn.run("SET hnsw_enable_experimental_persistence = true;");

  return new DbConnection(conn, instance);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries - 1) throw err;
      await Bun.sleep(100 * 2 ** attempt);
    }
  }
  throw lastError;
}
