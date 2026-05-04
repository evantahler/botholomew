import { appendFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { getThreadsDir } from "../constants.ts";
import { uuidv7 } from "../db/uuid.ts";
import { atomicWrite } from "../fs/atomic.ts";

/**
 * Thread + interaction history, stored as CSV files under
 * `<projectDir>/context/threads/<id>.csv`. The `context/` placement is
 * deliberate: prior conversations are knowledge the agent should be able
 * to search via the same hybrid index it uses for everything else.
 *
 * CSV schema (8 columns, RFC-4180 quoting):
 *   created_at, role, kind, content, tool_name, tool_input,
 *   duration_ms, token_count
 *
 * Thread metadata (title, source_type, parent_task_id, ended_at) is encoded
 * as a synthetic first row with `kind="thread_meta"` whose `content` is a
 * JSON blob. End-of-thread is a `kind="thread_ended"` row. That keeps the
 * format pure CSV — no sidecar files, no frontmatter — at the cost of a
 * full file rewrite when we need to update the title.
 */

export type ThreadType = "worker_tick" | "chat_session";
export type InteractionRole = "user" | "assistant" | "system" | "tool";
export type InteractionKind =
  | "message"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "context_update"
  | "status_change";

export interface Thread {
  id: string;
  type: ThreadType;
  task_id: string | null;
  title: string;
  started_at: Date;
  ended_at: Date | null;
}

export interface Interaction {
  id: string; // synthesized as `<thread_id>:<sequence>` for back-compat with callers
  thread_id: string;
  sequence: number;
  role: InteractionRole;
  kind: InteractionKind;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  duration_ms: number | null;
  token_count: number | null;
  created_at: Date;
}

const HEADER =
  "created_at,role,kind,content,tool_name,tool_input,duration_ms,token_count\n";

interface ThreadMetaPayload {
  type: ThreadType;
  task_id: string | null;
  title: string;
  started_at: string;
}

function threadFilePath(projectDir: string, id: string): string {
  return join(getThreadsDir(projectDir), `${id}.csv`);
}

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return `${cells.map(csvField).join(",")}\n`;
}

/**
 * Parse a CSV file produced by this module. Accepts RFC-4180 quoting:
 *   - fields may be quoted with `"`,
 *   - inside a quoted field, `""` is an escaped quote,
 *   - quoted fields may span newlines.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function createThread(
  projectDir: string,
  type: ThreadType,
  taskId?: string,
  title?: string,
): Promise<string> {
  const id = uuidv7();
  const now = new Date().toISOString();
  const meta: ThreadMetaPayload = {
    type,
    task_id: taskId ?? null,
    title: title ?? "",
    started_at: now,
  };
  const body =
    HEADER +
    csvRow([
      now,
      "system",
      "thread_meta",
      JSON.stringify(meta),
      "",
      "",
      "",
      "",
    ]);
  await atomicWrite(threadFilePath(projectDir, id), body);
  return id;
}

export async function logInteraction(
  projectDir: string,
  threadId: string,
  params: {
    role: InteractionRole;
    kind: InteractionKind;
    content: string;
    toolName?: string;
    toolInput?: string;
    durationMs?: number;
    tokenCount?: number;
  },
): Promise<string> {
  const path = threadFilePath(projectDir, threadId);
  const row = csvRow([
    new Date().toISOString(),
    params.role,
    params.kind,
    params.content,
    params.toolName ?? "",
    params.toolInput ?? "",
    params.durationMs ?? "",
    params.tokenCount ?? "",
  ]);
  // Append is atomic-enough for a single writer (each thread is owned by
  // one chat session or one worker tick at a time). If a second writer
  // sneaks in we get interleaved bytes — a known accepted limitation; we
  // can swap in a lockfile per-thread if it becomes an issue.
  await appendFile(path, row, "utf-8");
  // Synthesize an id stable across reads: `<thread>:<seq>`. Sequence is
  // the data row index (rows after the header).
  const sequence = (await readRows(path)).length - 1;
  return `${threadId}:${sequence}`;
}

export async function endThread(
  projectDir: string,
  threadId: string,
): Promise<void> {
  await appendFile(
    threadFilePath(projectDir, threadId),
    csvRow([
      new Date().toISOString(),
      "system",
      "thread_ended",
      "",
      "",
      "",
      "",
      "",
    ]),
    "utf-8",
  );
}

export async function reopenThread(
  projectDir: string,
  threadId: string,
): Promise<void> {
  // "Reopen" = drop the most recent thread_ended marker if there is one.
  const path = threadFilePath(projectDir, threadId);
  const rows = await readRows(path);
  if (rows.length === 0) return;
  const last = rows[rows.length - 1];
  if (!last) return;
  if (last[2] !== "thread_ended") return;
  rows.pop();
  await rewrite(path, rows);
}

export async function updateThreadTitle(
  projectDir: string,
  threadId: string,
  title: string,
): Promise<void> {
  const path = threadFilePath(projectDir, threadId);
  const rows = await readRows(path);
  const metaIdx = rows.findIndex((r) => r[2] === "thread_meta");
  if (metaIdx === -1) return;
  const metaRow = rows[metaIdx];
  if (!metaRow) return;
  let meta: ThreadMetaPayload;
  try {
    meta = JSON.parse(metaRow[3] ?? "{}") as ThreadMetaPayload;
  } catch {
    return;
  }
  meta.title = title;
  metaRow[3] = JSON.stringify(meta);
  await rewrite(path, rows);
}

export async function getThread(
  projectDir: string,
  threadId: string,
): Promise<{ thread: Thread; interactions: Interaction[] } | null> {
  const path = threadFilePath(projectDir, threadId);
  const rows = await readRows(path);
  if (rows.length === 0) return null;
  return rowsToThread(threadId, rows);
}

export async function deleteThread(
  projectDir: string,
  threadId: string,
): Promise<boolean> {
  try {
    await rm(threadFilePath(projectDir, threadId));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function deleteAllThreads(
  projectDir: string,
): Promise<{ threads: number; interactions: number }> {
  const dir = getThreadsDir(projectDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { threads: 0, interactions: 0 };
    }
    throw err;
  }
  let threads = 0;
  let interactions = 0;
  for (const name of names) {
    if (!name.endsWith(".csv")) continue;
    const path = join(dir, name);
    const rows = await readRows(path);
    interactions += Math.max(0, rows.length - 1); // exclude meta row
    await rm(path).catch(() => {});
    threads++;
  }
  return { threads, interactions };
}

export async function getInteractionsAfter(
  projectDir: string,
  threadId: string,
  afterSequence: number,
): Promise<Interaction[]> {
  const t = await getThread(projectDir, threadId);
  if (!t) return [];
  return t.interactions.filter((i) => i.sequence > afterSequence);
}

export async function getActiveThread(
  projectDir: string,
): Promise<Thread | null> {
  const summaries = await listThreads(projectDir);
  for (const t of summaries) {
    if (!t.ended_at) return t;
  }
  return null;
}

export async function isThreadEnded(
  projectDir: string,
  threadId: string,
): Promise<boolean> {
  const t = await getThread(projectDir, threadId);
  if (!t) return true;
  return t.thread.ended_at !== null;
}

export async function listThreads(
  projectDir: string,
  filters?: {
    type?: ThreadType;
    taskId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<Thread[]> {
  const dir = getThreadsDir(projectDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Thread[] = [];
  for (const name of names) {
    if (!name.endsWith(".csv")) continue;
    const id = name.slice(0, -".csv".length);
    const data = await getThread(projectDir, id);
    if (!data) continue;
    const t = data.thread;
    if (filters?.type && t.type !== filters.type) continue;
    if (filters?.taskId && t.task_id !== filters.taskId) continue;
    out.push(t);
  }
  out.sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? out.length;
  return out.slice(offset, offset + limit);
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

async function readRows(path: string): Promise<string[][]> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows = parseCsv(text);
  if (rows.length > 0 && rows[0]?.[0] === "created_at") {
    rows.shift(); // drop header
  }
  return rows;
}

async function rewrite(path: string, rows: string[][]): Promise<void> {
  const body =
    HEADER +
    rows
      .map((r) =>
        csvRow([
          r[0] ?? "",
          r[1] ?? "",
          r[2] ?? "",
          r[3] ?? "",
          r[4] ?? "",
          r[5] ?? "",
          r[6] ?? "",
          r[7] ?? "",
        ]),
      )
      .join("");
  await atomicWrite(path, body);
}

function rowsToThread(
  threadId: string,
  rows: string[][],
): { thread: Thread; interactions: Interaction[] } | null {
  const metaRow = rows.find((r) => r[2] === "thread_meta");
  if (!metaRow) return null;
  let meta: ThreadMetaPayload;
  try {
    meta = JSON.parse(metaRow[3] ?? "{}") as ThreadMetaPayload;
  } catch {
    return null;
  }
  const startedAt = new Date(meta.started_at);
  const endedRow = [...rows].reverse().find((r) => r[2] === "thread_ended");
  const endedAt = endedRow ? new Date(endedRow[0] ?? "") : null;

  const interactions: Interaction[] = [];
  let seq = 0;
  for (const r of rows) {
    if (r[2] === "thread_meta" || r[2] === "thread_ended") continue;
    seq += 1;
    const role = (r[1] ?? "system") as InteractionRole;
    const kind = (r[2] ?? "message") as InteractionKind;
    interactions.push({
      id: `${threadId}:${seq}`,
      thread_id: threadId,
      sequence: seq,
      role,
      kind,
      content: r[3] ?? "",
      tool_name: r[4] ? r[4] : null,
      tool_input: r[5] ? r[5] : null,
      duration_ms: r[6] ? Number(r[6]) : null,
      token_count: r[7] ? Number(r[7]) : null,
      created_at: new Date(r[0] ?? ""),
    });
  }

  return {
    thread: {
      id: threadId,
      type: meta.type,
      task_id: meta.task_id,
      title: meta.title,
      started_at: startedAt,
      ended_at: endedAt,
    },
    interactions,
  };
}

/** Best-effort ensure the threads directory exists (e.g. before first write). */
export async function ensureThreadsDir(projectDir: string): Promise<void> {
  const dir = getThreadsDir(projectDir);
  try {
    await stat(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
  }
}
