import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getExtensionPath } from "@sqliteai/sqlite-vector";

export type DbConnection = Database;

// Bun bundles its own SQLite, but on macOS it uses Apple's proprietary build
// which has sqlite3_load_extension() disabled for security. Since we need
// loadable extensions (sqlite-vector), we swap in Homebrew's vanilla SQLite
// via setCustomSQLite(). This must be called exactly once, before any
// Database instance is created. On Linux, Bun's bundled SQLite supports
// extensions natively, so no swap is needed.
let sqliteConfigured = false;

function ensureCustomSQLite(): void {
  if (sqliteConfigured) return;
  sqliteConfigured = true;

  if (process.platform !== "darwin") return;

  // Homebrew sqlite paths (arm64 and x86_64)
  const candidates = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  ];
  const sqlitePath = candidates.find((p) => existsSync(p));
  if (sqlitePath) {
    Database.setCustomSQLite(sqlitePath);
  }
}

export function getConnection(dbPath: string): Database {
  ensureCustomSQLite();
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.loadExtension(getExtensionPath());
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
