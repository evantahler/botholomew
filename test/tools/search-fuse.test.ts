import { describe, expect, test } from "bun:test";
import { fuseRRF } from "../../src/tools/search/fuse.ts";
import type { RegexpHit } from "../../src/tools/search/regexp.ts";
import type { SemanticHit } from "../../src/tools/search/semantic.ts";

function rx(path: string, line: number): RegexpHit {
  return {
    ref: `agent:${path}`,
    drive: "agent",
    path,
    line,
    content: `match @${line}`,
    context_lines: [],
  };
}

function sem(path: string, score = 0.5, chunk = "chunk content"): SemanticHit {
  return {
    ref: `agent:${path}`,
    drive: "agent",
    path,
    context_item_id: `id-${path}`,
    chunk_index: 0,
    title: path,
    chunk_content: chunk,
    score,
  };
}

describe("fuseRRF", () => {
  test("regexp-only hits get match_type 'regexp' and null semantic_score", () => {
    const out = fuseRRF([rx("/a", 1), rx("/b", 2)], [], { limit: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]?.match_type).toBe("regexp");
    expect(out[0]?.semantic_score).toBeNull();
    expect(out[0]?.line).toBe(1);
  });

  test("semantic-only hits get match_type 'semantic' and null line", () => {
    const out = fuseRRF([], [sem("/a"), sem("/b")], { limit: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]?.match_type).toBe("semantic");
    expect(out[0]?.line).toBeNull();
    expect(out[0]?.semantic_score).not.toBeNull();
  });

  test("regexp hit on a path also matched semantically becomes 'both' and scores higher than either alone", () => {
    const both = fuseRRF([rx("/a", 1)], [sem("/a")], { limit: 10 });
    const regexpOnly = fuseRRF([rx("/a", 1)], [], { limit: 10 });
    const semanticOnly = fuseRRF([], [sem("/a")], { limit: 10 });

    expect(both[0]?.match_type).toBe("both");
    expect(both[0]?.semantic_score).not.toBeNull();
    expect(both[0]?.line).toBe(1);
    expect(both[0]?.score).toBeGreaterThan(regexpOnly[0]?.score ?? 0);
    expect(both[0]?.score).toBeGreaterThan(semanticOnly[0]?.score ?? 0);
  });

  test("'both' rows float to the top of mixed results", () => {
    // Two files: /a has both regexp + semantic; /b has only semantic.
    const out = fuseRRF([rx("/a", 1)], [sem("/a"), sem("/b")], { limit: 10 });
    expect(out[0]?.path).toBe("/a");
    expect(out[0]?.match_type).toBe("both");
    expect(out[1]?.path).toBe("/b");
    expect(out[1]?.match_type).toBe("semantic");
  });

  test("semantic hits on paths already represented by regexp are dropped (no duplicate row)", () => {
    const out = fuseRRF([rx("/a", 5)], [sem("/a")], { limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]?.match_type).toBe("both");
  });

  test("respects limit", () => {
    const hits: RegexpHit[] = [
      rx("/a", 1),
      rx("/b", 1),
      rx("/c", 1),
      rx("/d", 1),
    ];
    const out = fuseRRF(hits, [], { limit: 2 });
    expect(out).toHaveLength(2);
  });
});
