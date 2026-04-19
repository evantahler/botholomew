import type { Command } from "commander";
import { getDbPath } from "../constants.ts";
import type { DbConnection } from "../db/connection.ts";
import { withDb as coreWithDb } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";

/**
 * Open a migrated DB connection from the CLI --dir flag, run the callback,
 * and guarantee the connection is closed afterward. Retries on lock
 * conflicts so CLI invocations cooperate with running workers or chat.
 */
export async function withDb<T>(
  program: Command,
  fn: (conn: DbConnection, dir: string) => Promise<T>,
): Promise<T> {
  const dir = program.opts().dir;
  const dbPath = getDbPath(dir);
  return coreWithDb(dbPath, async (conn) => {
    await migrate(conn);
    return fn(conn, dir);
  });
}
