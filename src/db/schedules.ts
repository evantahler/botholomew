import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause } from "./query.ts";
import { uuidv7 } from "./uuid.ts";

export interface Schedule {
  id: string;
  name: string;
  description: string;
  frequency: string;
  last_run_at: Date | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ScheduleRow {
  id: string;
  name: string;
  description: string;
  frequency: string;
  last_run_at: string | null;
  enabled: number;
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
    enabled: row.enabled === 1,
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
  const row = db
    .query(
      `INSERT INTO schedules (id, name, description, frequency)
     VALUES (?1, ?2, ?3, ?4)
     RETURNING *`,
    )
    .get(
      id,
      params.name,
      params.description ?? "",
      params.frequency,
    ) as ScheduleRow | null;
  if (!row) throw new Error("INSERT did not return a row");
  return rowToSchedule(row);
}

export async function getSchedule(
  db: DbConnection,
  id: string,
): Promise<Schedule | null> {
  const row = db
    .query("SELECT * FROM schedules WHERE id = ?1")
    .get(id) as ScheduleRow | null;
  return row ? rowToSchedule(row) : null;
}

export async function listSchedules(
  db: DbConnection,
  filters?: { enabled?: boolean },
): Promise<Schedule[]> {
  const { where, params } = buildWhereClause([
    [
      "enabled",
      filters?.enabled !== undefined ? (filters.enabled ? 1 : 0) : undefined,
    ],
  ]);

  const rows = db
    .query(`SELECT * FROM schedules ${where} ORDER BY created_at ASC`)
    .all(...params) as ScheduleRow[];
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

  setClauses.push("updated_at = datetime('now')");
  params.push(id);

  const row = db
    .query(
      `UPDATE schedules SET ${setClauses.join(", ")} WHERE id = ?${params.length} RETURNING *`,
    )
    .get(...params) as ScheduleRow | null;
  return row ? rowToSchedule(row) : null;
}

export async function deleteSchedule(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  const result = db.query("DELETE FROM schedules WHERE id = ?1").run(id);
  return result.changes > 0;
}

export async function markScheduleRun(
  db: DbConnection,
  id: string,
): Promise<void> {
  db.query(
    `UPDATE schedules SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`,
  ).run(id);
}
