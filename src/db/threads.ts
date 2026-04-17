import type { DbConnection } from "./connection.ts";
import { buildWhereClause } from "./query.ts";
import { uuidv7 } from "./uuid.ts";

export interface Thread {
  id: string;
  type: "daemon_tick" | "chat_session";
  task_id: string | null;
  title: string;
  started_at: Date;
  ended_at: Date | null;
  metadata: string | null;
}

export interface Interaction {
  id: string;
  thread_id: string;
  sequence: number;
  role: "user" | "assistant" | "system" | "tool";
  kind:
    | "message"
    | "thinking"
    | "tool_use"
    | "tool_result"
    | "context_update"
    | "status_change";
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  duration_ms: number | null;
  token_count: number | null;
  created_at: Date;
}

interface ThreadRow {
  id: string;
  type: string;
  task_id: string | null;
  title: string;
  started_at: string;
  ended_at: string | null;
  metadata: string | null;
}

interface InteractionRow {
  id: string;
  thread_id: string;
  sequence: number;
  role: string;
  kind: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  duration_ms: number | null;
  token_count: number | null;
  created_at: string;
}

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    type: row.type as Thread["type"],
    task_id: row.task_id,
    title: row.title,
    started_at: new Date(row.started_at),
    ended_at: row.ended_at ? new Date(row.ended_at) : null,
    metadata: row.metadata,
  };
}

function rowToInteraction(row: InteractionRow): Interaction {
  return {
    id: row.id,
    thread_id: row.thread_id,
    sequence: row.sequence,
    role: row.role as Interaction["role"],
    kind: row.kind as Interaction["kind"],
    content: row.content,
    tool_name: row.tool_name,
    tool_input: row.tool_input,
    duration_ms: row.duration_ms,
    token_count: row.token_count,
    created_at: new Date(row.created_at),
  };
}

export async function createThread(
  db: DbConnection,
  type: Thread["type"],
  taskId?: string,
  title?: string,
): Promise<string> {
  const id = uuidv7();
  await db.queryRun(
    `INSERT INTO threads (id, type, task_id, title)
     VALUES (?1, ?2, ?3, ?4)`,
    id,
    type,
    taskId ?? null,
    title ?? "",
  );
  return id;
}

export async function logInteraction(
  db: DbConnection,
  threadId: string,
  params: {
    role: Interaction["role"];
    kind: Interaction["kind"];
    content: string;
    toolName?: string;
    toolInput?: string;
    durationMs?: number;
    tokenCount?: number;
  },
): Promise<string> {
  // Get next sequence number
  const seqRow = await db.queryGet<{ next_seq: number }>(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM interactions WHERE thread_id = ?1",
    threadId,
  );
  const sequence = seqRow?.next_seq ?? 1;

  const id = uuidv7();
  await db.queryRun(
    `INSERT INTO interactions (id, thread_id, sequence, role, kind, content, tool_name, tool_input, duration_ms, token_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    id,
    threadId,
    sequence,
    params.role,
    params.kind,
    params.content,
    params.toolName ?? null,
    params.toolInput ?? null,
    params.durationMs ?? null,
    params.tokenCount ?? null,
  );
  return id;
}

export async function endThread(
  db: DbConnection,
  threadId: string,
): Promise<void> {
  await db.queryRun(
    "UPDATE threads SET ended_at = current_timestamp::VARCHAR WHERE id = ?1",
    threadId,
  );
}

export async function reopenThread(
  db: DbConnection,
  threadId: string,
): Promise<void> {
  await db.queryRun(
    "UPDATE threads SET ended_at = NULL WHERE id = ?1",
    threadId,
  );
}

export async function updateThreadTitle(
  db: DbConnection,
  threadId: string,
  title: string,
): Promise<void> {
  await db.queryRun(
    "UPDATE threads SET title = ?2 WHERE id = ?1",
    threadId,
    title,
  );
}

export async function getThread(
  db: DbConnection,
  threadId: string,
): Promise<{ thread: Thread; interactions: Interaction[] } | null> {
  const threadRow = await db.queryGet<ThreadRow>(
    "SELECT * FROM threads WHERE id = ?1",
    threadId,
  );
  if (!threadRow) return null;

  const interactionRows = await db.queryAll<InteractionRow>(
    "SELECT * FROM interactions WHERE thread_id = ?1 ORDER BY sequence ASC",
    threadId,
  );

  return {
    thread: rowToThread(threadRow),
    interactions: interactionRows.map(rowToInteraction),
  };
}

export async function deleteThread(
  db: DbConnection,
  threadId: string,
): Promise<boolean> {
  await db.queryRun("DELETE FROM interactions WHERE thread_id = ?1", threadId);
  const result = await db.queryRun(
    "DELETE FROM threads WHERE id = ?1",
    threadId,
  );
  return result.changes > 0;
}

export async function deleteAllThreads(
  db: DbConnection,
): Promise<{ threads: number; interactions: number }> {
  const interactions = await db.queryRun("DELETE FROM interactions");
  const threads = await db.queryRun("DELETE FROM threads");
  return {
    threads: threads.changes,
    interactions: interactions.changes,
  };
}

export async function getInteractionsAfter(
  db: DbConnection,
  threadId: string,
  afterSequence: number,
): Promise<Interaction[]> {
  const rows = await db.queryAll<InteractionRow>(
    `SELECT * FROM interactions WHERE thread_id = ?1 AND sequence > ?2 ORDER BY sequence ASC`,
    threadId,
    afterSequence,
  );
  return rows.map(rowToInteraction);
}

export async function getActiveThread(
  db: DbConnection,
): Promise<Thread | null> {
  const row = await db.queryGet<ThreadRow>(
    `SELECT * FROM threads WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
  return row ? rowToThread(row) : null;
}

export async function isThreadEnded(
  db: DbConnection,
  threadId: string,
): Promise<boolean> {
  const row = await db.queryGet<{ ended_at: string | null }>(
    `SELECT ended_at FROM threads WHERE id = ?1`,
    threadId,
  );
  if (!row) return true;
  return row.ended_at !== null;
}

export async function listThreads(
  db: DbConnection,
  filters?: {
    type?: Thread["type"];
    taskId?: string;
    limit?: number;
  },
): Promise<Thread[]> {
  const { where, params } = buildWhereClause([
    ["type", filters?.type],
    ["task_id", filters?.taskId],
  ]);
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  const rows = await db.queryAll<ThreadRow>(
    `SELECT * FROM threads ${where}
     ORDER BY started_at DESC
     ${limit}`,
    ...params,
  );
  return rows.map(rowToThread);
}
