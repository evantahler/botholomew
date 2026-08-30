import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getApprovalsDir } from "../../../constants.ts";
import { atomicWrite } from "../../../fs/atomic.ts";
import { uuidv7 } from "../../../utils/uuid.ts";

export interface RunInvocationInput {
  source: string;
  output_logical_path?: string;
  change_note?: string;
  max_input_bytes?: number;
}

export interface StoredRunContinuation {
  run_id: string;
  task_id: string;
  thread_id: string | null;
  worker_id: string | null;
  source: string;
  output_logical_path?: string;
  change_note?: string;
  max_input_bytes?: number;
  continuation: string;
  continuation_context: unknown;
  approval_ids: string[];
  created_at: string;
  updated_at: string;
}

export function runContinuationPath(projectDir: string, runId: string): string {
  return join(getApprovalsDir(projectDir), `${runId}.run.json`);
}

export async function writeRunContinuation(
  projectDir: string,
  record: StoredRunContinuation,
): Promise<void> {
  await atomicWrite(
    runContinuationPath(projectDir, record.run_id),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

export async function readRunContinuation(
  projectDir: string,
  runId: string,
): Promise<StoredRunContinuation | null> {
  try {
    const raw = await Bun.file(runContinuationPath(projectDir, runId)).text();
    return JSON.parse(raw) as StoredRunContinuation;
  } catch {
    return null;
  }
}

export async function deleteRunContinuation(
  projectDir: string,
  runId: string,
): Promise<void> {
  try {
    await unlink(runContinuationPath(projectDir, runId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function findRunContinuationForTask(
  projectDir: string,
  taskId: string,
): Promise<StoredRunContinuation | null> {
  const dir = getApprovalsDir(projectDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const matches: StoredRunContinuation[] = [];
  for (const name of names) {
    if (!name.endsWith(".run.json")) continue;
    try {
      const raw = await Bun.file(join(dir, name)).text();
      const parsed = JSON.parse(raw) as StoredRunContinuation;
      if (parsed.task_id === taskId) matches.push(parsed);
    } catch {
      // Malformed, or deleted by a concurrent resume — skip it.
    }
  }
  matches.sort((a, b) => (a.run_id < b.run_id ? 1 : -1));
  return matches[0] ?? null;
}

export function newRunId(): string {
  return uuidv7();
}
