import { Database } from "bun:sqlite";

export type DbConnection = Database;

export function getConnection(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
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
      const isBusy =
        err instanceof Error &&
        (err.message.includes("SQLITE_BUSY") ||
          err.message.includes("database is locked"));
      if (!isBusy || attempt === maxRetries - 1) throw err;
      // exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
      await Bun.sleep(100 * 2 ** attempt);
    }
  }
  throw lastError;
}
