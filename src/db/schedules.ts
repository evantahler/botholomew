import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause, sanitizeInt } from "./query.ts";
import { uuidv7 } from "./uuid.ts";

export interface Schedule {
  id: string;
  name: string;
  description: string;
  frequency: string;
  last_run_at: Date | null;
  enabled: boolean;
  claimed_by: string | null;
  claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ScheduleRow {
  id: string;
  name: string;
  description: string;
  frequency: string;
  last_run_at: string | null;
  enabled: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    last_run_at: row.last_run_at ? new Date(row.last_run_at) : null,
    enabled: !!row.enabled,
    claimed_by: row.claimed_by ?? null,
    claimed_at: row.claimed_at ? new Date(row.claimed_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function createSchedule(
  db: DbConnection,
  params: {
    name: string;
    description?: string;
    frequency: string;
  },
): Promise<Schedule> {
  const id = uuidv7();
  const row = await db.queryGet<ScheduleRow>(
    `INSERT INTO schedules (id, name, description, frequency)
     VALUES (?1, ?2, ?3, ?4)
     RETURNING *`,
    id,
    params.name,
    params.description ?? "",
    params.frequency,
  );
  if (!row) throw new Error("INSERT did not return a row");
  return rowToSchedule(row);
}

export async function getSchedule(
  db: DbConnection,
  id: string,
): Promise<Schedule | null> {
  const row = await db.queryGet<ScheduleRow>(
    "SELECT * FROM schedules WHERE id = ?1",
    id,
  );
  return row ? rowToSchedule(row) : null;
}

export async function listSchedules(
  db: DbConnection,
  filters?: { enabled?: boolean; limit?: number; offset?: number },
): Promise<Schedule[]> {
  const { where, params } = buildWhereClause([
    [
      "enabled",
      filters?.enabled !== undefined ? (filters.enabled ? 1 : 0) : undefined,
    ],
  ]);
  const limit = filters?.limit ? `LIMIT ${sanitizeInt(filters.limit)}` : "";
  const offset = filters?.offset ? `OFFSET ${sanitizeInt(filters.offset)}` : "";

  const rows = await db.queryAll<ScheduleRow>(
    `SELECT * FROM schedules ${where}
     ORDER BY created_at ASC, id ASC
     ${limit} ${offset}`,
    ...params,
  );
  return rows.map(rowToSchedule);
}

export async function updateSchedule(
  db: DbConnection,
  id: string,
  updates: Partial<
    Pick<Schedule, "name" | "description" | "frequency" | "enabled">
  >,
): Promise<Schedule | null> {
  const { setClauses, params } = buildSetClauses([
    ["name", updates.name],
    ["description", updates.description],
    ["frequency", updates.frequency],
    [
      "enabled",
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : undefined,
    ],
  ]);

  if (setClauses.length === 0) {
    return getSchedule(db, id);
  }

  setClauses.push("updated_at = current_timestamp::VARCHAR");
  params.push(id);

  const row = await db.queryGet<ScheduleRow>(
    `UPDATE schedules SET ${setClauses.join(", ")} WHERE id = ?${params.length} RETURNING *`,
    ...params,
  );
  return row ? rowToSchedule(row) : null;
}

export async function deleteSchedule(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  const result = await db.queryRun("DELETE FROM schedules WHERE id = ?1", id);
  return result.changes > 0;
}

export async function deleteAllSchedules(db: DbConnection): Promise<number> {
  const result = await db.queryRun("DELETE FROM schedules");
  return result.changes;
}

export async function markScheduleRun(
  db: DbConnection,
  id: string,
): Promise<void> {
  await db.queryRun(
    `UPDATE schedules SET last_run_at = current_timestamp::VARCHAR, updated_at = current_timestamp::VARCHAR WHERE id = ?1`,
    id,
  );
}

/**
 * Atomically claim a schedule for evaluation. Returns the schedule if
 * successfully claimed, or null if another worker already holds the claim
 * or the schedule ran too recently to re-evaluate.
 *
 * `staleAfterSeconds`: how long an existing claim is considered still-held
 * before another worker may steal it (protects against crashed claimers).
 * `minIntervalSeconds`: minimum gap since `last_run_at` before re-evaluation.
 */
export async function claimSchedule(
  db: DbConnection,
  id: string,
  claimedBy: string,
  opts: { staleAfterSeconds: number; minIntervalSeconds: number },
): Promise<Schedule | null> {
  const row = await db.queryGet<ScheduleRow>(
    `UPDATE schedules
     SET claimed_by = ?1,
         claimed_at = current_timestamp::VARCHAR
     WHERE id = ?2
       AND enabled = true
       AND (
         claimed_by IS NULL
         OR claimed_at IS NULL
         OR claimed_at::TIMESTAMP
            < current_timestamp - to_seconds(CAST(?3 AS BIGINT))
       )
       AND (
         last_run_at IS NULL
         OR last_run_at::TIMESTAMP
            < current_timestamp - to_seconds(CAST(?4 AS BIGINT))
       )
     RETURNING *`,
    claimedBy,
    id,
    opts.staleAfterSeconds,
    opts.minIntervalSeconds,
  );
  return row ? rowToSchedule(row) : null;
}

/**
 * Release a schedule claim without modifying `last_run_at`. Safe to call
 * even if the claim has already expired — the WHERE guard ensures we only
 * clear our own claim.
 */
export async function releaseSchedule(
  db: DbConnection,
  id: string,
  claimedBy: string,
): Promise<void> {
  await db.queryRun(
    `UPDATE schedules
     SET claimed_by = NULL, claimed_at = NULL
     WHERE id = ?1 AND claimed_by = ?2`,
    id,
    claimedBy,
  );
}
