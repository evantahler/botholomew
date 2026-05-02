import { formatDriveRef } from "../../context/drives.ts";
import { embedSingle } from "../../context/embedder.ts";
import { type HybridSearchResult, hybridSearch } from "../../db/embeddings.ts";
import type { ToolContext } from "../tool.ts";
import { globToRegex } from "./regexp.ts";

export interface SemanticHit {
  ref: string;
  drive: string | null;
  path: string | null;
  context_item_id: string;
  chunk_index: number;
  title: string;
  chunk_content: string;
  score: number;
}

export interface SemanticOptions {
  query: string;
  drive?: string;
  path?: string;
  glob?: string;
  limit?: number;
}

/**
 * Run the embedding + hybrid-search pipeline. Scoping (`drive` / `path` /
 * `glob`) is applied as a *post-filter* on results so the caller gets
 * consistent behavior whether they used the regex side, the semantic side,
 * or both.
 */
export async function runSemantic(
  ctx: ToolContext,
  options: SemanticOptions,
): Promise<SemanticHit[]> {
  const queryVec = await embedSingle(options.query, ctx.config);
  const results = await hybridSearch(
    ctx.conn,
    options.query,
    queryVec,
    options.limit ?? 100,
  );

  return results.filter((r) => matchesScope(r, options)).map(toHit);
}

function matchesScope(
  result: HybridSearchResult,
  options: SemanticOptions,
): boolean {
  if (options.drive && result.drive !== options.drive) return false;
  if (options.path && result.path) {
    const prefix = options.path.endsWith("/")
      ? options.path
      : `${options.path}/`;
    if (result.path !== options.path && !result.path.startsWith(prefix)) {
      return false;
    }
  }
  if (options.glob && result.path) {
    const filename = result.path.split("/").pop() ?? "";
    if (!globToRegex(options.glob).test(filename)) return false;
  }
  return true;
}

function toHit(r: HybridSearchResult): SemanticHit {
  return {
    ref:
      r.drive && r.path
        ? formatDriveRef({ drive: r.drive, path: r.path })
        : r.context_item_id,
    drive: r.drive,
    path: r.path,
    context_item_id: r.context_item_id,
    chunk_index: r.chunk_index,
    title: r.title,
    chunk_content: r.chunk_content ?? "",
    score: r.score,
  };
}
