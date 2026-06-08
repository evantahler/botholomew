import { createHash } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { getApprovalsDir } from "../constants.ts";
import {
  atomicWrite,
  atomicWriteIfUnchanged,
  readWithMtime,
} from "../fs/atomic.ts";
import { logger } from "../utils/logger.ts";
import { uuidv7 } from "../utils/uuid.ts";
import {
  type Approval,
  type ApprovalFrontmatter,
  ApprovalFrontmatterSchema,
  type ApprovalStatus,
} from "./schema.ts";

export function approvalFilePath(projectDir: string, id: string): string {
  return join(getApprovalsDir(projectDir), `${id}.md`);
}

/**
 * Stable key for an mcpx call: a hash over server + tool + canonicalized args
 * (object keys sorted recursively) so the same logical call always produces
 * the same key regardless of argument ordering.
 */
export function callKey(
  server: string,
  tool: string,
  args: Record<string, unknown> | undefined,
): string {
  const canonical = canonicalize(args ?? {});
  const payload = JSON.stringify({ server, tool, args: canonical });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function approvalBody(fm: ApprovalFrontmatter): string {
  let argsPretty = fm.args;
  try {
    argsPretty = JSON.stringify(JSON.parse(fm.args), null, 2);
  } catch {
    // leave as-is
  }
  return [
    `# Approval: ${fm.server}/${fm.tool}`,
    "",
    `Status: **${fm.status}**`,
    "",
    "## Arguments",
    "",
    "```json",
    argsPretty,
    "```",
  ].join("\n");
}

export function serializeApproval(
  fm: ApprovalFrontmatter,
  body?: string,
): string {
  const content = body ?? approvalBody(fm);
  return matter.stringify(
    `\n${content.trim()}\n`,
    fm as Record<string, unknown>,
  );
}

export interface ApprovalParseOk {
  ok: true;
  approval: Approval;
}
export interface ApprovalParseFail {
  ok: false;
  reason: string;
}

export function parseApprovalFile(
  raw: string,
  mtimeMs: number,
): ApprovalParseOk | ApprovalParseFail {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { ok: false, reason: `frontmatter parse error: ${err}` };
  }
  const result = ApprovalFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      ok: false,
      reason: `frontmatter validation failed: ${result.error.message}`,
    };
  }
  return {
    ok: true,
    approval: { ...result.data, mtimeMs, body: parsed.content.trim() },
  };
}

export async function listApprovalFiles(projectDir: string): Promise<string[]> {
  const dir = getApprovalsDir(projectDir);
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function getApproval(
  projectDir: string,
  id: string,
): Promise<Approval | null> {
  const file = await readWithMtime(approvalFilePath(projectDir, id));
  if (!file) return null;
  const parsed = parseApprovalFile(file.content, file.mtimeMs);
  if (!parsed.ok) {
    logger.warn(`Approval ${id} is malformed: ${parsed.reason}`);
    return null;
  }
  return parsed.approval;
}

export async function listApprovals(
  projectDir: string,
  filters?: { status?: ApprovalStatus; limit?: number; offset?: number },
): Promise<Approval[]> {
  const ids = await listApprovalFiles(projectDir);
  const approvals: Approval[] = [];
  for (const id of ids) {
    const a = await getApproval(projectDir, id);
    if (!a) continue;
    if (filters?.status && a.status !== filters.status) continue;
    approvals.push(a);
  }
  // Newest-first by id (uuidv7 is time-ordered) for deterministic pagination.
  approvals.sort((a, b) => (a.id < b.id ? 1 : -1));
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? approvals.length;
  return approvals.slice(offset, offset + limit);
}

export async function createApproval(
  projectDir: string,
  params: {
    server: string;
    tool: string;
    args?: Record<string, unknown>;
    reason?: string;
    task_id?: string | null;
    thread_id?: string | null;
    worker_id?: string | null;
  },
): Promise<Approval> {
  const id = uuidv7();
  const now = new Date().toISOString();
  const fm: ApprovalFrontmatter = {
    id,
    status: "pending",
    server: params.server,
    tool: params.tool,
    args: JSON.stringify(params.args ?? {}),
    call_key: callKey(params.server, params.tool, params.args),
    task_id: params.task_id ?? null,
    thread_id: params.thread_id ?? null,
    worker_id: params.worker_id ?? null,
    reason: params.reason ?? "",
    created_at: now,
    updated_at: now,
    decided_at: null,
    decided_by: null,
  };
  await atomicWrite(approvalFilePath(projectDir, id), serializeApproval(fm));
  const fresh = await getApproval(projectDir, id);
  if (!fresh) throw new Error(`Failed to read freshly created approval ${id}`);
  return fresh;
}

export class ApprovalNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Approval not found: ${id}`);
    this.name = "ApprovalNotFoundError";
  }
}

/**
 * Record a human decision (approve/deny) on a pending approval. Atomic
 * write-if-unchanged so a concurrent edit doesn't get clobbered.
 */
export async function decideApproval(
  projectDir: string,
  id: string,
  decision: "approved" | "denied",
  decidedBy: string,
): Promise<Approval> {
  const a = await getApproval(projectDir, id);
  if (!a) throw new ApprovalNotFoundError(id);
  const fm: ApprovalFrontmatter = {
    ...stripRuntime(a),
    status: decision,
    decided_at: new Date().toISOString(),
    decided_by: decidedBy,
    updated_at: new Date().toISOString(),
  };
  await atomicWriteIfUnchanged(
    approvalFilePath(projectDir, id),
    serializeApproval(fm),
    a.mtimeMs,
  );
  const fresh = await getApproval(projectDir, id);
  if (!fresh) throw new ApprovalNotFoundError(id);
  return fresh;
}

/**
 * Find the most-recent approval record for a call key (any status), or null.
 * Used by the worker callback to resolve a gated call against a prior decision.
 */
export async function findByCallKey(
  projectDir: string,
  key: string,
): Promise<Approval | null> {
  const all = await listApprovals(projectDir);
  for (const a of all) {
    // listApprovals is newest-first, so the first match is the latest.
    if (a.call_key === key) return a;
  }
  return null;
}

/**
 * Delete an approval record. Approvals are single-use: once an approved record
 * has authorized its call, it's consumed so a later identical call re-prompts.
 */
export async function consumeApproval(
  projectDir: string,
  id: string,
): Promise<boolean> {
  try {
    await unlink(approvalFilePath(projectDir, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function deleteAllApprovals(projectDir: string): Promise<number> {
  const ids = await listApprovalFiles(projectDir);
  let n = 0;
  for (const id of ids) {
    if (await consumeApproval(projectDir, id)) n++;
  }
  return n;
}

/** Drop the in-memory-only fields before writing frontmatter back to disk. */
function stripRuntime(a: Approval): ApprovalFrontmatter {
  const { mtimeMs: _m, body: _b, ...fm } = a;
  return fm;
}
