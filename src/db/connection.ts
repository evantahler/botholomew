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
  private readonly ownedInstance: any;
  private readonly dbPath: string;
  private closed = false;

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
    conn: any,
    // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
    ownedInstance: any,
    dbPath: string,
  ) {
    this.conn = conn;
    this.ownedInstance = ownedInstance;
    this.dbPath = dbPath;
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

  /**
   * Disconnect and release this connection's share of the DuckDB instance.
   * For file-backed DBs, the instance is closed (and the OS file lock
   * released) once every overlapping connection in this process has closed.
   * For `:memory:` DBs, the instance is owned by this connection and closed
   * immediately.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.conn.disconnectSync();
    if (this.ownedInstance) {
      this.ownedInstance.closeSync();
    } else {
      releaseInstance(this.dbPath);
    }
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

/**
 * Refcounted, process-local cache of open DuckDB instances keyed by dbPath.
 *
 * DuckDB's file lock is held at the instance level, so we must close the
 * instance — not just the connection — to let another process acquire the
 * writer lock. At the same time, opening two instances for the same file
 * from one process is unsafe. This cache resolves both: overlapping
 * `getConnection` calls in the same process share a single instance; once
 * every connection has closed, the instance is closed and evicted, which
 * releases the OS file lock.
 *
 * `:memory:` paths bypass the cache so each test/caller gets its own
 * isolated in-memory database.
 */
interface CachedInstance {
  // biome-ignore lint/suspicious/noExplicitAny: DuckDB internal types
  instance: any;
  refCount: number;
}
const instanceCache = new Map<string, CachedInstance>();
const pendingInstance = new Map<string, Promise<CachedInstance>>();

function isMemoryPath(path: string): boolean {
  return path === ":memory:" || path.startsWith(":memory:");
}

async function acquireSharedInstance(dbPath: string): Promise<CachedInstance> {
  const existing = instanceCache.get(dbPath);
  if (existing) {
    existing.refCount += 1;
    return existing;
  }
  const inFlight = pendingInstance.get(dbPath);
  if (inFlight) {
    const cached = await inFlight;
    cached.refCount += 1;
    return cached;
  }
  const creation = (async () => {
    const instance = await DuckDBInstance.create(dbPath);
    const cached: CachedInstance = { instance, refCount: 1 };
    instanceCache.set(dbPath, cached);
    return cached;
  })();
  pendingInstance.set(dbPath, creation);
  try {
    return await creation;
  } finally {
    pendingInstance.delete(dbPath);
  }
}

function releaseInstance(dbPath: string): void {
  const cached = instanceCache.get(dbPath);
  if (!cached) return;
  cached.refCount -= 1;
  if (cached.refCount <= 0) {
    instanceCache.delete(dbPath);
    cached.instance.closeSync();
  }
}

export async function getConnection(dbPath?: string): Promise<DbConnection> {
  const path = dbPath ?? ":memory:";

  if (isMemoryPath(path)) {
    const instance = await DuckDBInstance.create(path);
    const conn = await instance.connect();
    await conn.run("INSTALL vss; LOAD vss;");
    await conn.run("SET hnsw_enable_experimental_persistence = true;");
    return new DbConnection(conn, instance, path);
  }

  const cached = await acquireSharedInstance(path);
  try {
    const conn = await cached.instance.connect();
    // INSTALL is a no-op after the first successful install (the extension
    // is persisted to the user's DuckDB extension directory). LOAD is
    // cheap per connection.
    await conn.run("INSTALL vss; LOAD vss;");
    await conn.run("SET hnsw_enable_experimental_persistence = true;");
    return new DbConnection(conn, null, path);
  } catch (err) {
    releaseInstance(path);
    throw err;
  }
}

/**
 * Open a DuckDB connection for a single logical unit of work and guarantee
 * it is closed afterward. Retries on lock conflicts so two processes that
 * race on the file lock cooperate instead of failing hard.
 *
 * Prefer one `withDb` per logical operation. The file lock is only released
 * when every connection (across this process's overlapping callers) has
 * been closed, so holding the connection across non-DB work (LLM calls,
 * network I/O, filesystem walks) keeps other processes blocked.
 */
export async function withDb<T>(
  dbPath: string,
  fn: (conn: DbConnection) => Promise<T>,
): Promise<T> {
  const conn = await withRetry(() => getConnection(dbPath));
  try {
    return await fn(conn);
  } finally {
    conn.close();
  }
}

/**
 * Retry `fn` with exponential backoff when it fails with a DuckDB file-lock
 * conflict ("Conflicting lock is held…"). Other errors propagate immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 8,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isLockConflict(err)) throw err;
      lastError = err;
      if (attempt === maxRetries - 1) throw err;
      // 100, 200, 400, 800, 1600, 3200, 6400, 12800 — up to ~25s total
      await Bun.sleep(100 * 2 ** attempt);
    }
  }
  throw lastError;
}

function isLockConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Conflicting lock") || msg.includes("could not be set");
}
