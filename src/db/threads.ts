import type { DuckDBConnection } from "./connection.ts";

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

function rowToThread(row: unknown[]): Thread {
  return {
    id: String(row[0]),
    type: String(row[1]) as Thread["type"],
    task_id: row[2] ? String(row[2]) : null,
    title: String(row[3]),
    started_at: new Date(String(row[4])),
    ended_at: row[5] ? new Date(String(row[5])) : null,
    metadata: row[6] ? String(row[6]) : null,
  };
}

function rowToInteraction(row: unknown[]): Interaction {
  return {
    id: String(row[0]),
    thread_id: String(row[1]),
    sequence: Number(row[2]),
    role: String(row[3]) as Interaction["role"],
    kind: String(row[4]) as Interaction["kind"],
    content: String(row[5]),
    tool_name: row[6] ? String(row[6]) : null,
    tool_input: row[7] ? String(row[7]) : null,
    duration_ms: row[8] ? Number(row[8]) : null,
    token_count: row[9] ? Number(row[9]) : null,
    created_at: new Date(String(row[10])),
  };
}

export async function createThread(
  conn: DuckDBConnection,
  type: Thread["type"],
  taskId?: string,
  title?: string,
): Promise<string> {
  const taskIdVal = taskId ? `'${escape(taskId)}'` : "NULL";
  const titleVal = title ? `'${escape(title)}'` : "''";

  const result = await conn.runAndReadAll(`
    INSERT INTO threads (type, task_id, title)
    VALUES ('${type}', ${taskIdVal}, ${titleVal})
    RETURNING id
  `);
  return String(result.getRows()[0]![0]);
}

export async function logInteraction(
  conn: DuckDBConnection,
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
  const seqResult = await conn.runAndReadAll(`
    SELECT COALESCE(MAX(sequence), 0) + 1 FROM interactions WHERE thread_id = '${escape(threadId)}'
  `);
  const sequence = Number(seqResult.getRows()[0]![0]);

  const toolName = params.toolName ? `'${escape(params.toolName)}'` : "NULL";
  const toolInput = params.toolInput ? `'${escape(params.toolInput)}'` : "NULL";
  const durationMs = params.durationMs ?? "NULL";
  const tokenCount = params.tokenCount ?? "NULL";

  const result = await conn.runAndReadAll(`
    INSERT INTO interactions (thread_id, sequence, role, kind, content, tool_name, tool_input, duration_ms, token_count)
    VALUES ('${escape(threadId)}', ${sequence}, '${params.role}', '${params.kind}', '${escape(params.content)}', ${toolName}, ${toolInput}, ${durationMs}, ${tokenCount})
    RETURNING id
  `);
  return String(result.getRows()[0]![0]);
}

export async function endThread(
  conn: DuckDBConnection,
  threadId: string,
): Promise<void> {
  await conn.run(`
    UPDATE threads SET ended_at = current_timestamp WHERE id = '${escape(threadId)}'
  `);
}

export async function getThread(
  conn: DuckDBConnection,
  threadId: string,
): Promise<{ thread: Thread; interactions: Interaction[] } | null> {
  const threadResult = await conn.runAndReadAll(
    `SELECT * FROM threads WHERE id = '${escape(threadId)}'`,
  );
  const threadRows = threadResult.getRows();
  if (threadRows.length === 0) return null;

  const interactionsResult = await conn.runAndReadAll(`
    SELECT * FROM interactions WHERE thread_id = '${escape(threadId)}' ORDER BY sequence ASC
  `);

  return {
    thread: rowToThread(threadRows[0]!),
    interactions: interactionsResult.getRows().map(rowToInteraction),
  };
}

export async function listThreads(
  conn: DuckDBConnection,
  filters?: {
    type?: Thread["type"];
    taskId?: string;
    limit?: number;
  },
): Promise<Thread[]> {
  const conditions: string[] = [];
  if (filters?.type) conditions.push(`type = '${filters.type}'`);
  if (filters?.taskId) conditions.push(`task_id = '${escape(filters.taskId)}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  const result = await conn.runAndReadAll(`
    SELECT * FROM threads ${where}
    ORDER BY started_at DESC
    ${limit}
  `);
  return result.getRows().map(rowToThread);
}

function escape(str: string): string {
  return str.replace(/'/g, "''");
}
