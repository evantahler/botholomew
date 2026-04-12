import type { DuckDBConnection } from "./connection.ts";

export interface Task {
  id: string;
  name: string;
  description: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "failed" | "complete" | "waiting";
  waiting_reason: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  blocked_by: string[];
  context_ids: string[];
  created_at: Date;
  updated_at: Date;
}

function rowToTask(row: unknown[]): Task {
  return {
    id: String(row[0]),
    name: String(row[1]),
    description: String(row[2]),
    priority: String(row[3]) as Task["priority"],
    status: String(row[4]) as Task["status"],
    waiting_reason: row[5] ? String(row[5]) : null,
    claimed_by: row[6] ? String(row[6]) : null,
    claimed_at: row[7] ? new Date(String(row[7])) : null,
    blocked_by: row[8] ? (row[8] as string[]) : [],
    context_ids: row[9] ? (row[9] as string[]) : [],
    created_at: new Date(String(row[10])),
    updated_at: new Date(String(row[11])),
  };
}

export async function createTask(
  conn: DuckDBConnection,
  params: {
    name: string;
    description?: string;
    priority?: Task["priority"];
    blocked_by?: string[];
    context_ids?: string[];
  },
): Promise<Task> {
  const blockedBy = params.blocked_by?.length
    ? `ARRAY[${params.blocked_by.map((id) => `'${id}'`).join(",")}]::VARCHAR[]`
    : "NULL";
  const contextIds = params.context_ids?.length
    ? `ARRAY[${params.context_ids.map((id) => `'${id}'`).join(",")}]::VARCHAR[]`
    : "NULL";

  const result = await conn.runAndReadAll(`
    INSERT INTO tasks (name, description, priority, blocked_by, context_ids)
    VALUES ('${escape(params.name)}', '${escape(params.description ?? "")}', '${params.priority ?? "medium"}', ${blockedBy}, ${contextIds})
    RETURNING *
  `);
  return rowToTask(result.getRows()[0]!);
}

export async function getTask(
  conn: DuckDBConnection,
  id: string,
): Promise<Task | null> {
  const result = await conn.runAndReadAll(
    `SELECT * FROM tasks WHERE id = '${escape(id)}'`,
  );
  const rows = result.getRows();
  return rows.length > 0 ? rowToTask(rows[0]!) : null;
}

export async function listTasks(
  conn: DuckDBConnection,
  filters?: {
    status?: Task["status"];
    priority?: Task["priority"];
    limit?: number;
  },
): Promise<Task[]> {
  const conditions: string[] = [];
  if (filters?.status) conditions.push(`status = '${filters.status}'`);
  if (filters?.priority) conditions.push(`priority = '${filters.priority}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  const result = await conn.runAndReadAll(`
    SELECT * FROM tasks ${where}
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at ASC
    ${limit}
  `);
  return result.getRows().map(rowToTask);
}

export async function updateTaskStatus(
  conn: DuckDBConnection,
  id: string,
  status: Task["status"],
  reason?: string,
): Promise<void> {
  const reasonClause = reason
    ? `, waiting_reason = '${escape(reason)}'`
    : ", waiting_reason = NULL";

  await conn.run(`
    UPDATE tasks
    SET status = '${status}', updated_at = current_timestamp ${reasonClause}
    WHERE id = '${escape(id)}'
  `);
}

export async function claimNextTask(
  conn: DuckDBConnection,
  claimedBy = "daemon",
): Promise<Task | null> {
  // Find highest-priority unblocked pending task
  const result = await conn.runAndReadAll(`
    SELECT * FROM tasks
    WHERE status = 'pending'
      AND (
        blocked_by IS NULL
        OR array_length(blocked_by) = 0
        OR NOT EXISTS (
          SELECT 1 FROM unnest(blocked_by) AS b(id)
          WHERE b.id NOT IN (SELECT id FROM tasks WHERE status = 'complete')
        )
      )
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at ASC
    LIMIT 1
  `);

  const rows = result.getRows();
  if (rows.length === 0) return null;

  const task = rowToTask(rows[0]!);

  // Claim it atomically
  await conn.run(`
    UPDATE tasks
    SET status = 'in_progress',
        claimed_by = '${escape(claimedBy)}',
        claimed_at = current_timestamp,
        updated_at = current_timestamp
    WHERE id = '${escape(task.id)}' AND status = 'pending'
  `);

  return { ...task, status: "in_progress", claimed_by: claimedBy };
}

function escape(str: string): string {
  return str.replace(/'/g, "''");
}
