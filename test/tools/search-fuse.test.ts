/**
 * Pure unit tests for fuseRRF: reciprocal-rank-fusion of regexp line hits
 * and semantic chunk hits.
 */

import { describe, expect, test } from "bun:test";
import { fuseRRF } from "../../src/tools/search/fuse.ts";
import type { RegexpHit } from "../../src/tools/search/regexp.ts";
import type { SemanticHit } from "../../src/tools/search/semantic.ts";

function rx(path: string, line: number): RegexpHit {
  return {
    path,
    line,
    content: `match @${line}`,
    context_lines: [],
  };
}

function sem(path: string, score = 0.5, chunk = "chunk content"): SemanticHit {
  return {
    path,
    chunk_index: 0,
    chunk_content: chunk,
    score,
  };
}

describe("fuseRRF", () => {
  test("regexp-only hits get match_type 'regexp' and null semantic_score", () => {
    const out = fuseRRF([rx("notes/a.md", 1), rx("notes/b.md", 2)], [], {
      limit: 10,
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.match_type).toBe("regexp");
    expect(out[0]?.semantic_score).toBeNull();
    expect(out[0]?.line).toBe(1);
  });

  test("semantic-only hits get match_type 'semantic' and null line", () => {
    const out = fuseRRF([], [sem("notes/a.md"), sem("notes/b.md")], {
      limit: 10,
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.match_type).toBe("semantic");
    expect(out[0]?.line).toBeNull();
    expect(out[0]?.semantic_score).not.toBeNull();
  });

  test("regexp hit on a path also matched semantically becomes 'both' and outscores either alone", () => {
    const both = fuseRRF([rx("notes/a.md", 1)], [sem("notes/a.md")], {
      limit: 10,
    });
    const regexpOnly = fuseRRF([rx("notes/a.md", 1)], [], { limit: 10 });
    const semanticOnly = fuseRRF([], [sem("notes/a.md")], { limit: 10 });

    expect(both[0]?.match_type).toBe("both");
    expect(both[0]?.semantic_score).not.toBeNull();
    expect(both[0]?.line).toBe(1);
    expect(both[0]?.score).toBeGreaterThan(regexpOnly[0]?.score ?? 0);
    expect(both[0]?.score).toBeGreaterThan(semanticOnly[0]?.score ?? 0);
  });

  test("'both' rows float to the top of mixed results", () => {
    // Two files: a.md has both regexp + semantic; b.md has only semantic.
    const out = fuseRRF(
      [rx("notes/a.md", 1)],
      [sem("notes/a.md"), sem("notes/b.md")],
      { limit: 10 },
    );
    expect(out[0]?.path).toBe("notes/a.md");
    expect(out[0]?.match_type).toBe("both");
    expect(out[1]?.path).toBe("notes/b.md");
    expect(out[1]?.match_type).toBe("semantic");
  });

  test("semantic hits on paths already represented by regexp don't emit duplicate rows", () => {
    const out = fuseRRF([rx("notes/a.md", 5)], [sem("notes/a.md")], {
      limit: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.match_type).toBe("both");
  });

  test("respects limit", () => {
    const hits: RegexpHit[] = [
      rx("notes/a.md", 1),
      rx("notes/b.md", 1),
      rx("notes/c.md", 1),
      rx("notes/d.md", 1),
    ];
    const out = fuseRRF(hits, [], { limit: 2 });
    expect(out).toHaveLength(2);
  });

  test("multiple regexp hits on the same path each emit their own row", () => {
    const out = fuseRRF(
      [rx("notes/a.md", 1), rx("notes/a.md", 5), rx("notes/a.md", 10)],
      [],
      { limit: 10 },
    );
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.line).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
      1, 5, 10,
    ]);
  });
});
