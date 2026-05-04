import type { BotholomewConfig } from "../../config/schemas.ts";
import { embed, embedSingle } from "../../context/embedder.ts";
import { listContextDir, readContextFile } from "../../context/store.ts";
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

// Each file is embedded as a single chunk truncated to MAX_CHARS. Good enough
// for short notes; long files only match against their head until the indexed
// search pipeline lands. The follow-on "Disk-Backed Project Layout" milestone
// adds proper chunked + persistent indexing.
const MAX_CHARS = 4_000;
const MAX_FILES_TO_EMBED = 200;

export async function runSemantic(
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
    candidates.push({ path: entry.path, content: content.slice(0, MAX_CHARS) });
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
