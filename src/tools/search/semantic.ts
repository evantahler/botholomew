import type { BotholomewConfig } from "../../config/schemas.ts";
import { embed, embedSingle } from "../../context/embedder.ts";
import { listContextDir, readContextFile } from "../../context/store.ts";
import { withDb } from "../../db/connection.ts";
import { indexStats, searchSemantic } from "../../db/embeddings.ts";
import { globToRegex } from "./regexp.ts";

export interface SemanticHit {
  path: string;
  chunk_index: number;
  chunk_content: string;
  score: number;
}

export interface SemanticOptions {
  query: string;
  scope?: string;
  glob?: string;
  limit?: number;
}

// On-the-fly fallback (used when the index sidecar is empty / stale).
// One chunk per file truncated to MAX_CHARS; the indexed path is much faster
// and supports proper chunking via `botholomew context reindex`.
const MAX_CHARS = 4_000;
const MAX_FILES_TO_EMBED = 200;

/**
 * Semantic search over `context/`. Prefers the persistent index sidecar
 * (`context_index` table, populated by `botholomew context reindex`) when
 * it has rows. Falls back to embedding files on the fly so a fresh project
 * still gets useful results before the user has reindexed once.
 */
export async function runSemantic(
  projectDir: string,
  config: Required<BotholomewConfig>,
  dbPath: string | null,
  options: SemanticOptions,
): Promise<SemanticHit[]> {
  if (dbPath) {
    const indexed = await tryIndexedSearch(dbPath, config, options);
    if (indexed) return indexed;
  }
  return runOnTheFly(projectDir, config, options);
}

async function tryIndexedSearch(
  dbPath: string,
  config: Required<BotholomewConfig>,
  options: SemanticOptions,
): Promise<SemanticHit[] | null> {
  let stats: Awaited<ReturnType<typeof indexStats>>;
  try {
    stats = await withDb(dbPath, indexStats);
  } catch {
    return null;
  }
  if (stats.embedded === 0) return null;

  const queryVec = await embedSingle(options.query, config);
  const limit = options.limit ?? 100;
  const rows = await withDb(dbPath, (conn) =>
    searchSemantic(conn, queryVec, limit * 4),
  );

  const globRegex = options.glob ? globToRegex(options.glob) : null;
  const scope = options.scope
    ? options.scope.endsWith("/")
      ? options.scope
      : `${options.scope}/`
    : null;

  const filtered: SemanticHit[] = [];
  for (const r of rows) {
    if (scope && !r.path.startsWith(scope) && r.path !== options.scope) {
      continue;
    }
    if (globRegex) {
      const filename = r.path.split("/").pop() ?? "";
      if (!globRegex.test(filename)) continue;
    }
    filtered.push({
      path: r.path,
      chunk_index: r.chunk_index,
      chunk_content: r.chunk_content,
      score: r.score,
    });
    if (filtered.length >= limit) break;
  }
  return filtered;
}

async function runOnTheFly(
  projectDir: string,
  config: Required<BotholomewConfig>,
  options: SemanticOptions,
): Promise<SemanticHit[]> {
  const entries = await listContextDir(projectDir, options.scope ?? "", {
    recursive: true,
  });
  const globRegex = options.glob ? globToRegex(options.glob) : null;

  const candidates: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    if (entry.is_directory) continue;
    if (!entry.is_textual) continue;
    if (globRegex) {
      const filename = entry.path.split("/").pop() ?? "";
      if (!globRegex.test(filename)) continue;
    }
    let content: string;
    try {
      content = await readContextFile(projectDir, entry.path);
    } catch {
      continue;
    }
    if (content.trim().length === 0) continue;
    candidates.push({
      path: entry.path,
      content: content.slice(0, MAX_CHARS),
    });
    if (candidates.length >= MAX_FILES_TO_EMBED) break;
  }

  if (candidates.length === 0) return [];

  const [queryVec, fileVecs] = await Promise.all([
    embedSingle(options.query, config),
    embed(
      candidates.map((c) => c.content),
      config,
    ),
  ]);

  const limit = options.limit ?? 100;
  const scored: SemanticHit[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const v = fileVecs[i];
    if (!c || !v) continue;
    const score = cosine(queryVec, v);
    scored.push({
      path: c.path,
      chunk_index: 0,
      chunk_content: c.content,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
