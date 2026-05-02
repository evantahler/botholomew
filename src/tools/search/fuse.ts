import type { RegexpHit } from "./regexp.ts";
import type { SemanticHit } from "./semantic.ts";

export interface FusedMatch {
  ref: string;
  drive: string;
  path: string;
  line: number | null;
  content: string;
  context_lines: string[];
  match_type: "regexp" | "semantic" | "both";
  semantic_score: number | null;
  score: number;
}

const SNIPPET_MAX = 300;

/**
 * Reciprocal rank fusion of regexp line hits and semantic chunk hits.
 *
 * Each regexp hit becomes its own row. If the file (drive + path) also has a
 * semantic hit, the regexp row picks up that semantic side's RRF contribution
 * and is tagged `match_type: "both"` — exact-line + semantic agreement is
 * the strongest signal.
 *
 * Semantic hits are emitted as their own rows only for paths with no regexp
 * hit; otherwise the regexp row already represents that file (and is more
 * locatable). This keeps the result list focused without losing pure
 * semantic matches in files the regexp didn't touch.
 */
export function fuseRRF(
  regexpHits: RegexpHit[],
  semanticHits: SemanticHit[],
  options: { k?: number; limit: number },
): FusedMatch[] {
  const k = options.k ?? 60;

  const bestSemByPath = new Map<
    string,
    { rank: number; score: number; hit: SemanticHit }
  >();
  for (let i = 0; i < semanticHits.length; i++) {
    const hit = semanticHits[i];
    if (!hit) continue;
    const key = pathKey(hit.drive, hit.path);
    if (key == null) continue;
    const existing = bestSemByPath.get(key);
    if (!existing || i < existing.rank) {
      bestSemByPath.set(key, { rank: i, score: hit.score, hit });
    }
  }

  const regexpPaths = new Set<string>();
  for (const hit of regexpHits) {
    regexpPaths.add(pathKey(hit.drive, hit.path) ?? "");
  }

  const fused: FusedMatch[] = [];

  for (let i = 0; i < regexpHits.length; i++) {
    const rx = regexpHits[i];
    if (!rx) continue;
    const key = pathKey(rx.drive, rx.path) ?? "";
    const sem = bestSemByPath.get(key);
    let score = 1 / (k + i + 1);
    let matchType: FusedMatch["match_type"] = "regexp";
    let semanticScore: number | null = null;
    if (sem) {
      score += 1 / (k + sem.rank + 1);
      matchType = "both";
      semanticScore = round(sem.score);
    }
    fused.push({
      ref: rx.ref,
      drive: rx.drive,
      path: rx.path,
      line: rx.line,
      content: rx.content,
      context_lines: rx.context_lines,
      match_type: matchType,
      semantic_score: semanticScore,
      score: round(score),
    });
  }

  for (let i = 0; i < semanticHits.length; i++) {
    const sem = semanticHits[i];
    if (!sem) continue;
    const key = pathKey(sem.drive, sem.path);
    if (key == null) continue;
    if (regexpPaths.has(key)) continue;
    const score = 1 / (k + i + 1);
    fused.push({
      ref: sem.ref,
      drive: sem.drive ?? "",
      path: sem.path ?? "",
      line: null,
      content: sem.chunk_content.slice(0, SNIPPET_MAX),
      context_lines: [],
      match_type: "semantic",
      semantic_score: round(sem.score),
      score: round(score),
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, options.limit);
}

function pathKey(drive: string | null, path: string | null): string | null {
  if (!drive || !path) return null;
  return `${drive}:${path}`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
