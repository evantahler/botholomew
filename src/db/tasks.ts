import type { DbConnection } from "./connection.ts";
import { buildSetClauses, buildWhereClause, sanitizeInt } from "./query.ts";
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
  output: string | null;
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
  output: string | null;
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
    output: row.output,
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

  const row = await db.queryGet<TaskRow>(
    `INSERT INTO tasks (id, name, description, priority, blocked_by, context_ids)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     RETURNING *`,
    id,
    params.name,
    params.description ?? "",
    params.priority ?? "medium",
    blockedBy,
    contextIds,
  );
  if (!row) throw new Error("INSERT did not return a row");
  return rowToTask(row);
}

export async function getTask(
  db: DbConnection,
  id: string,
): Promise<Task | null> {
  const row = await db.queryGet<TaskRow>(
    "SELECT * FROM tasks WHERE id = ?1",
    id,
  );
  return row ? rowToTask(row) : null;
}

export async function listTasks(
  db: DbConnection,
  filters?: {
    status?: Task["status"];
    priority?: Task["priority"];
    limit?: number;
    offset?: number;
  },
): Promise<Task[]> {
  const { where, params } = buildWhereClause([
    ["status", filters?.status],
    ["priority", filters?.priority],
  ]);
  const limit = filters?.limit ? `LIMIT ${sanitizeInt(filters.limit)}` : "";
  const offset = filters?.offset ? `OFFSET ${sanitizeInt(filters.offset)}` : "";

  const rows = await db.queryAll<TaskRow>(
    `SELECT * FROM tasks ${where}
     ORDER BY created_at DESC, id DESC
     ${limit} ${offset}`,
    ...params,
  );
  return rows.map(rowToTask);
}

export async function updateTaskStatus(
  db: DbConnection,
  id: string,
  status: Task["status"],
  reason?: string | null,
  output?: string | null,
): Promise<void> {
  await db.queryRun(
    `UPDATE tasks
     SET status = ?1, waiting_reason = ?2, output = ?3, updated_at = current_timestamp::VARCHAR
     WHERE id = ?4`,
    status,
    reason ?? null,
    output ?? null,
    id,
  );
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

  setClauses.push("updated_at = current_timestamp::VARCHAR");
  params.push(id);

  const row = await db.queryGet<TaskRow>(
    `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?${params.length} RETURNING *`,
    ...params,
  );
  return row ? rowToTask(row) : null;
}

export async function deleteTask(
  db: DbConnection,
  id: string,
): Promise<boolean> {
  const result = await db.queryRun("DELETE FROM tasks WHERE id = ?1", id);
  return result.changes > 0;
}

export async function deleteAllTasks(db: DbConnection): Promise<number> {
  const result = await db.queryRun("DELETE FROM tasks");
  return result.changes;
}

export async function resetTask(
  db: DbConnection,
  id: string,
): Promise<Task | null> {
  const row = await db.queryGet<TaskRow>(
    `UPDATE tasks
     SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
         waiting_reason = NULL, output = NULL, updated_at = current_timestamp::VARCHAR
     WHERE id = ?1
     RETURNING *`,
    id,
  );
  return row ? rowToTask(row) : null;
}

export async function resetStaleTasks(
  db: DbConnection,
  timeoutSeconds: number,
): Promise<string[]> {
  const rows = await db.queryAll<{ id: string }>(
    `UPDATE tasks
     SET status = 'pending',
         claimed_by = NULL,
         claimed_at = NULL,
         updated_at = current_timestamp::VARCHAR
     WHERE status = 'in_progress'
       AND claimed_at IS NOT NULL
       AND claimed_at::TIMESTAMP < current_timestamp - to_seconds(CAST(?1 AS BIGINT))
     RETURNING id`,
    timeoutSeconds,
  );
  return rows.map((r) => r.id);
}

export async function claimNextTask(
  db: DbConnection,
  claimedBy: string,
): Promise<Task | null> {
  // Find highest-priority unblocked pending task
  // Use application-level filtering for blocked_by since DuckDB doesn't have json_each
  const allPending = await db.queryAll<TaskRow>(
    `SELECT * FROM tasks
     WHERE status = 'pending'
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
       created_at ASC`,
  );

  for (const row of allPending) {
    const blockedBy: string[] = JSON.parse(row.blocked_by || "[]");
    if (blockedBy.length > 0) {
      // Check if all blockers are complete
      let allComplete = true;
      for (const blockerId of blockedBy) {
        const blocker = await db.queryGet<{ status: string }>(
          "SELECT status FROM tasks WHERE id = ?1",
          blockerId,
        );
        if (!blocker || blocker.status !== "complete") {
          allComplete = false;
          break;
        }
      }
      if (!allComplete) continue;
    }

    // Attempt atomic claim — RETURNING confirms we actually got it
    const claimed = await db.queryGet<TaskRow>(
      `UPDATE tasks
       SET status = 'in_progress',
           claimed_by = ?1,
           claimed_at = current_timestamp::VARCHAR,
           updated_at = current_timestamp::VARCHAR
       WHERE id = ?2 AND status = 'pending'
       RETURNING *`,
      claimedBy,
      row.id,
    );

    if (claimed) {
      return rowToTask(claimed);
    }
    // Another process claimed it — try next candidate
  }

  return null;
}

/**
 * Atomically claim a specific task by id. Returns the task if successfully
 * claimed, or null if the task doesn't exist, is already claimed, or isn't
 * in `pending` state.
 */
export async function claimSpecificTask(
  db: DbConnection,
  taskId: string,
  claimedBy: string,
): Promise<Task | null> {
  const row = await db.queryGet<TaskRow>(
    `UPDATE tasks
     SET status = 'in_progress',
         claimed_by = ?1,
         claimed_at = current_timestamp::VARCHAR,
         updated_at = current_timestamp::VARCHAR
     WHERE id = ?2 AND status = 'pending'
     RETURNING *`,
    claimedBy,
    taskId,
  );
  return row ? rowToTask(row) : null;
}
