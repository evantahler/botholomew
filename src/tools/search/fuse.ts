import type { RegexpHit } from "./regexp.ts";
import type { SemanticHit } from "./semantic.ts";

export interface FusedMatch {
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
 * Reciprocal rank fusion of regexp line hits and semantic file hits.
 *
 * Each regexp hit becomes its own row. If the same file also has a semantic
 * hit, the regexp row picks up that semantic side's RRF contribution and is
 * tagged `match_type: "both"` — exact-line + semantic agreement is the
 * strongest signal.
 *
 * Semantic hits emit their own rows only for paths with no regexp hit.
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
    const existing = bestSemByPath.get(hit.path);
    if (!existing || i < existing.rank) {
      bestSemByPath.set(hit.path, { rank: i, score: hit.score, hit });
    }
  }

  const regexpPaths = new Set<string>();
  for (const hit of regexpHits) regexpPaths.add(hit.path);

  const fused: FusedMatch[] = [];

  for (let i = 0; i < regexpHits.length; i++) {
    const rx = regexpHits[i];
    if (!rx) continue;
    const sem = bestSemByPath.get(rx.path);
    let score = 1 / (k + i + 1);
    let matchType: FusedMatch["match_type"] = "regexp";
    let semanticScore: number | null = null;
    if (sem) {
      score += 1 / (k + sem.rank + 1);
      matchType = "both";
      semanticScore = round(sem.score);
    }
    fused.push({
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
    if (regexpPaths.has(sem.path)) continue;
    const score = 1 / (k + i + 1);
    fused.push({
      path: sem.path,
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

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
