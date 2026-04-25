import type { DbConnection } from "./connection.ts";
import { buildWhereClause, sanitizeInt } from "./query.ts";

export const WORKER_MODES = ["persist", "once"] as const;
export const WORKER_STATUSES = ["running", "stopped", "dead"] as const;

export interface Worker {
  id: string;
  pid: number;
  hostname: string;
  mode: (typeof WORKER_MODES)[number];
  task_id: string | null;
  status: (typeof WORKER_STATUSES)[number];
  started_at: Date;
  last_heartbeat_at: Date;
  stopped_at: Date | null;
  log_path: string | null;
}

interface WorkerRow {
  id: string;
  pid: number;
  hostname: string;
  mode: string;
  task_id: string | null;
  status: string;
  started_at: string;
  last_heartbeat_at: string;
  stopped_at: string | null;
  log_path: string | null;
}

function rowToWorker(row: WorkerRow): Worker {
  return {
    id: row.id,
    pid: row.pid,
    hostname: row.hostname,
    mode: row.mode as Worker["mode"],
    task_id: row.task_id,
    status: row.status as Worker["status"],
    started_at: new Date(row.started_at),
    last_heartbeat_at: new Date(row.last_heartbeat_at),
    stopped_at: row.stopped_at ? new Date(row.stopped_at) : null,
    log_path: row.log_path,
  };
}

export async function registerWorker(
  db: DbConnection,
  params: {
    id: string;
    pid: number;
    hostname: string;
    mode: Worker["mode"];
    taskId?: string | null;
    logPath?: string | null;
  },
): Promise<Worker> {
  const row = await db.queryGet<WorkerRow>(
    `INSERT INTO workers (id, pid, hostname, mode, task_id, status, log_path)
     VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)
     RETURNING *`,
    params.id,
    params.pid,
    params.hostname,
    params.mode,
    params.taskId ?? null,
    params.logPath ?? null,
  );
  if (!row) throw new Error("INSERT did not return a row");
  return rowToWorker(row);
}

export async function heartbeat(db: DbConnection, id: string): Promise<void> {
  await db.queryRun(
    `UPDATE workers
     SET last_heartbeat_at = current_timestamp::VARCHAR
     WHERE id = ?1 AND status = 'running'`,
    id,
  );
}

export async function markWorkerStopped(
  db: DbConnection,
  id: string,
): Promise<void> {
  await db.queryRun(
    `UPDATE workers
     SET status = 'stopped',
         stopped_at = current_timestamp::VARCHAR
     WHERE id = ?1 AND status = 'running'`,
    id,
  );
}

export async function markWorkerDead(
  db: DbConnection,
  id: string,
): Promise<void> {
  await db.queryRun(
    `UPDATE workers
     SET status = 'dead',
         stopped_at = current_timestamp::VARCHAR
     WHERE id = ?1 AND status = 'running'`,
    id,
  );
}

/**
 * Find running workers whose heartbeat is older than `staleAfterSeconds`,
 * mark them dead, and release any tasks/schedule claims they held back
 * to the pool. Returns the ids of reaped workers.
 */
export async function reapDeadWorkers(
  db: DbConnection,
  staleAfterSeconds: number,
): Promise<string[]> {
  const stale = await db.queryAll<{ id: string }>(
    `UPDATE workers
     SET status = 'dead',
         stopped_at = current_timestamp::VARCHAR
     WHERE status = 'running'
       AND last_heartbeat_at::TIMESTAMP
           < current_timestamp - to_seconds(CAST(?1 AS BIGINT))
     RETURNING id`,
    staleAfterSeconds,
  );
  const reapedIds = stale.map((r) => r.id);
  if (reapedIds.length === 0) return reapedIds;

  for (const reapedId of reapedIds) {
    await db.queryRun(
      `UPDATE tasks
       SET status = 'pending',
           claimed_by = NULL,
           claimed_at = NULL,
           updated_at = current_timestamp::VARCHAR
       WHERE claimed_by = ?1 AND status = 'in_progress'`,
      reapedId,
    );
    await db.queryRun(
      `UPDATE schedules
       SET claimed_by = NULL,
           claimed_at = NULL
       WHERE claimed_by = ?1`,
      reapedId,
    );
  }
  return reapedIds;
}

/**
 * Delete cleanly-stopped workers (status='stopped') whose `stopped_at` is
 * older than `afterSeconds`. Dead workers are intentionally left alone —
 * they're forensic evidence that something crashed.
 * Returns the ids that were pruned.
 */
export async function pruneStoppedWorkers(
  db: DbConnection,
  afterSeconds: number,
): Promise<string[]> {
  const rows = await db.queryAll<{ id: string }>(
    `DELETE FROM workers
     WHERE status = 'stopped'
       AND stopped_at IS NOT NULL
       AND stopped_at::TIMESTAMP
           < current_timestamp - to_seconds(CAST(?1 AS BIGINT))
     RETURNING id`,
    afterSeconds,
  );
  return rows.map((r) => r.id);
}

export async function listWorkers(
  db: DbConnection,
  filters?: {
    status?: Worker["status"];
    limit?: number;
    offset?: number;
  },
): Promise<Worker[]> {
  const { where, params } = buildWhereClause([["status", filters?.status]]);
  const limit = filters?.limit ? `LIMIT ${sanitizeInt(filters.limit)}` : "";
  const offset = filters?.offset ? `OFFSET ${sanitizeInt(filters.offset)}` : "";

  const rows = await db.queryAll<WorkerRow>(
    `SELECT * FROM workers ${where}
     ORDER BY started_at DESC, id DESC
     ${limit} ${offset}`,
    ...params,
  );
  return rows.map(rowToWorker);
}

export async function getWorker(
  db: DbConnection,
  id: string,
): Promise<Worker | null> {
  const row = await db.queryGet<WorkerRow>(
    "SELECT * FROM workers WHERE id = ?1",
    id,
  );
  return row ? rowToWorker(row) : null;
}

export async function deleteWorker(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  const result = await db.queryRun("DELETE FROM workers WHERE id = ?1", id);
  return result.changes > 0;
}
