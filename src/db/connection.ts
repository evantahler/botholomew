import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";

export type { DuckDBConnection } from "@duckdb/node-api";

export async function getConnection(dbPath: string): Promise<DuckDBConnection> {
  return withRetry(async () => {
    const instance = await DuckDBInstance.create(dbPath);
    return instance.connect();
  });
}

export async function getMemoryConnection(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(":memory:");
  return instance.connect();
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
        (err.message.includes("BUSY") || err.message.includes("lock"));
      if (!isBusy || attempt === maxRetries - 1) throw err;
      // exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
      await Bun.sleep(100 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}
