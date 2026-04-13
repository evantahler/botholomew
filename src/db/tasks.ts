import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause } from "./query.ts";
import { uuidv7 } from "./uuid.ts";

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "failed",
  "complete",
  "waiting",
] as const;

export interface Task {
  id: string;
  name: string;
  description: string;
  priority: (typeof TASK_PRIORITIES)[number];
  status: (typeof TASK_STATUSES)[number];
  waiting_reason: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  blocked_by: string[];
  context_ids: string[];
  created_at: Date;
  updated_at: Date;
}

interface TaskRow {
  id: string;
  name: string;
  description: string;
  priority: string;
  status: string;
  waiting_reason: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  blocked_by: string;
  context_ids: string;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priority: row.priority as Task["priority"],
    status: row.status as Task["status"],
    waiting_reason: row.waiting_reason,
    claimed_by: row.claimed_by,
    claimed_at: row.claimed_at ? new Date(row.claimed_at) : null,
    blocked_by: JSON.parse(row.blocked_by || "[]"),
    context_ids: JSON.parse(row.context_ids || "[]"),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function createTask(
  db: DbConnection,
  params: {
    name: string;
    description?: string;
    priority?: Task["priority"];
    blocked_by?: string[];
    context_ids?: string[];
  },
): Promise<Task> {
  const id = uuidv7();
  const blockedByArr = params.blocked_by ?? [];
  await validateBlockedBy(db, id, blockedByArr);
  const blockedBy = JSON.stringify(blockedByArr);
  const contextIds = JSON.stringify(params.context_ids ?? []);

  const row = db
    .query(
      `INSERT INTO tasks (id, name, description, priority, blocked_by, context_ids)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     RETURNING *`,
    )
    .get(
      id,
      params.name,
      params.description ?? "",
      params.priority ?? "medium",
      blockedBy,
      contextIds,
    ) as TaskRow | null;
  if (!row) throw new Error("INSERT did not return a row");
  return rowToTask(row);
}

export async function getTask(
  db: DbConnection,
  id: string,
): Promise<Task | null> {
  const row = db
    .query("SELECT * FROM tasks WHERE id = ?1")
    .get(id) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export async function listTasks(
  db: DbConnection,
  filters?: {
    status?: Task["status"];
    priority?: Task["priority"];
    limit?: number;
  },
): Promise<Task[]> {
  const { where, params } = buildWhereClause([
    ["status", filters?.status],
    ["priority", filters?.priority],
  ]);
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  const rows = db
    .query(
      `SELECT * FROM tasks ${where}
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
       created_at ASC
     ${limit}`,
    )
    .all(...params) as TaskRow[];
  return rows.map(rowToTask);
}

export async function updateTaskStatus(
  db: DbConnection,
  id: string,
  status: Task["status"],
  reason?: string,
): Promise<void> {
  db.query(
    `UPDATE tasks
     SET status = ?1, waiting_reason = ?2, updated_at = datetime('now')
     WHERE id = ?3`,
  ).run(status, reason ?? null, id);
}

export async function validateBlockedBy(
  db: DbConnection,
  taskId: string,
  blockedBy: string[],
): Promise<void> {
  if (blockedBy.length === 0) return;

  // Check for direct self-reference
  if (blockedBy.includes(taskId)) {
    throw new Error(`Circular dependency: task ${taskId} cannot block itself`);
  }

  // DFS through transitive blocked_by chains
  const visited = new Set<string>();

  async function dfs(currentId: string): Promise<void> {
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const task = await getTask(db, currentId);
    if (!task) return;

    for (const dep of task.blocked_by) {
      if (dep === taskId) {
        throw new Error(
          `Circular dependency: adding blocked_by would create cycle involving task ${taskId}`,
        );
      }
      await dfs(dep);
    }
  }

  for (const blockerId of blockedBy) {
    await dfs(blockerId);
  }
}

export async function updateTask(
  db: DbConnection,
  id: string,
  updates: Partial<
    Pick<Task, "name" | "description" | "priority" | "status" | "blocked_by">
  >,
): Promise<Task | null> {
  if (updates.blocked_by !== undefined) {
    await validateBlockedBy(db, id, updates.blocked_by);
  }

  const { setClauses, params } = buildSetClauses([
    ["name", updates.name],
    ["description", updates.description],
    ["priority", updates.priority],
    ["status", updates.status],
    [
      "blocked_by",
      updates.blocked_by !== undefined
        ? JSON.stringify(updates.blocked_by)
        : undefined,
    ],
  ]);

  if (setClauses.length === 0) {
    return getTask(db, id);
  }

  setClauses.push("updated_at = datetime('now')");
  params.push(id);

  const row = db
    .query(
      `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?${params.length} RETURNING *`,
    )
    .get(...params) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export async function deleteTask(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  const result = db.query("DELETE FROM tasks WHERE id = ?1").run(id);
  return result.changes > 0;
}

export async function resetTask(
  db: DbConnection,
  id: string,
): Promise<Task | null> {
  const row = db
    .query(
      `UPDATE tasks
     SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
         waiting_reason = NULL, updated_at = datetime('now')
     WHERE id = ?1
     RETURNING *`,
    )
    .get(id) as TaskRow | null;
  return row ? rowToTask(row) : null;
}

export async function resetStaleTasks(
  db: DbConnection,
  timeoutSeconds: number,
): Promise<string[]> {
  const rows = db
    .query(
      `UPDATE tasks
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         updated_at = datetime('now')
     WHERE status = 'in_progress'
       AND claimed_at IS NOT NULL
       AND claimed_at < datetime('now', '-' || ?1 || ' seconds')
     RETURNING id`,
    )
    .all(timeoutSeconds) as { id: string }[];
  return rows.map((r) => r.id);
}

export async function claimNextTask(
  db: DbConnection,
  claimedBy = "daemon",
): Promise<Task | null> {
  // Find highest-priority unblocked pending task
  const row = db
    .query(
      `SELECT * FROM tasks
     WHERE status = 'pending'
       AND (
         blocked_by = '[]'
         OR blocked_by IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM json_each(blocked_by) AS b
           WHERE b.value NOT IN (SELECT id FROM tasks WHERE status = 'complete')
         )
       )
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
       created_at ASC
     LIMIT 1`,
    )
    .get() as TaskRow | null;

  if (!row) return null;
  const task = rowToTask(row);

  // Claim it
  db.query(
    `UPDATE tasks
     SET status = 'in_progress',
         claimed_by = ?1,
         claimed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?2 AND status = 'pending'`,
  ).run(claimedBy, task.id);

  return {
    ...task,
    status: "in_progress",
    claimed_by: claimedBy,
    claimed_at: new Date(),
  };
}
