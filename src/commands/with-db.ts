import type { Command } from "commander";
import { getDbPath } from "../constants.ts";
import type { DbConnection } from "../db/connection.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";

/**
 * Open a migrated DB connection from the CLI --dir flag, run the callback,
 * and guarantee the connection is closed afterward.
 */
export async function withDb<T>(
  program: Command,
  fn: (conn: DbConnection, dir: string) => Promise<T>,
): Promise<T> {
  const dir = program.opts().dir;
  const conn = await getConnection(getDbPath(dir));
  await migrate(conn);
  try {
    return await fn(conn, dir);
  } finally {
    conn.close();
  }
}
