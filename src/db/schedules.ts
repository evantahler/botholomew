import type { DbConnection } from "./connection.ts";
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
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.enabled !== undefined) {
    params.push(filters.enabled ? 1 : 0);
    conditions.push(`enabled = ?${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

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
  const setClauses: string[] = [];
  const params: (string | number)[] = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    setClauses.push(`name = ?${params.length}`);
  }
  if (updates.description !== undefined) {
    params.push(updates.description);
    setClauses.push(`description = ?${params.length}`);
  }
  if (updates.frequency !== undefined) {
    params.push(updates.frequency);
    setClauses.push(`frequency = ?${params.length}`);
  }
  if (updates.enabled !== undefined) {
    params.push(updates.enabled ? 1 : 0);
    setClauses.push(`enabled = ?${params.length}`);
  }

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
