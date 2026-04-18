import type { DbConnection } from "./connection.ts";

export async function deleteAllDaemonState(db: DbConnection): Promise<number> {
  const result = await db.queryRun("DELETE FROM daemon_state");
  return result.changes;
}
