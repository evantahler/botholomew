/**
 * The `context_index` CRUD layer + the search primitives that sit on top
 * of it. Vectors are content-aware fakes so cosine similarity tracks
 * word overlap (see fakeEmbed in helpers.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import {
  deleteIndexedPath,
  getIndexedPath,
  indexStats,
  listIndexedPaths,
  rebuildSearchIndex,
  searchHybrid,
  searchKeyword,
  searchSemantic,
  upsertChunksForPath,
} from "../../src/db/embeddings.ts";
import { migrate } from "../../src/db/schema.ts";
import { fakeEmbed } from "../helpers.ts";

let dbPath: string;
let dbDir: string;
let conn: DbConnection;

beforeEach(async () => {
  dbDir = await mkdtemp(join(tmpdir(), "both-emb-"));
  dbPath = join(dbDir, "index.duckdb");
  conn = await getConnection(dbPath);
  await migrate(conn);
});

afterEach(async () => {
  conn.close();
  await rm(dbDir, { recursive: true, force: true });
});

async function seed(
  path: string,
  chunks: Array<{ index: number; text: string }>,
) {
  await upsertChunksForPath(conn, {
    path,
    contentHash: `hash-${path}`,
    mtimeMs: Date.now(),
    sizeBytes: chunks.reduce((s, c) => s + c.text.length, 0),
    chunks: chunks.map((c) => ({
      chunk_index: c.index,
      chunk_content: c.text,
      embedding: fakeEmbed(c.text),
    })),
  });
}

describe("upsertChunksForPath", () => {
  test("inserts chunks and rejects wrong-dimension embeddings", async () => {
    await seed("a.md", [{ index: 0, text: "paternity leave" }]);
    const summary = await listIndexedPaths(conn);
    expect(summary.find((s) => s.path === "a.md")?.chunk_count).toBe(1);

    // Wrong-dim embedding should fail at the FLOAT[N] cast.
    await expect(
      upsertChunksForPath(conn, {
        path: "bad.md",
        contentHash: "h",
        mtimeMs: 0,
        sizeBytes: 0,
        chunks: [
          {
            chunk_index: 0,
            chunk_content: "x",
            embedding: new Array(EMBEDDING_DIMENSION + 1).fill(0),
          },
        ],
      }),
    ).rejects.toThrow();
  });

  test("re-upsert replaces previous chunks for the same path", async () => {
    await seed("a.md", [
      { index: 0, text: "first" },
      { index: 1, text: "second" },
    ]);
    await seed("a.md", [{ index: 0, text: "fresh" }]);
    const summary = await listIndexedPaths(conn);
    expect(summary.find((s) => s.path === "a.md")?.chunk_count).toBe(1);
  });
});

describe("deleteIndexedPath", () => {
  test("removes all rows for a path and reports the count", async () => {
    await seed("a.md", [
      { index: 0, text: "x" },
      { index: 1, text: "y" },
    ]);
    const removed = await deleteIndexedPath(conn, "a.md");
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await getIndexedPath(conn, "a.md")).toBeNull();
  });

  test("returns 0 when nothing matches", async () => {
    expect(await deleteIndexedPath(conn, "missing.md")).toBe(0);
  });

  test("does not delete chunks for other paths", async () => {
    await seed("a.md", [{ index: 0, text: "x" }]);
    await seed("b.md", [{ index: 0, text: "y" }]);
    await deleteIndexedPath(conn, "a.md");
    const summary = await listIndexedPaths(conn);
    expect(summary.map((s) => s.path).sort()).toEqual(["b.md"]);
  });
});

describe("listIndexedPaths + getIndexedPath + indexStats", () => {
  test("listIndexedPaths returns one summary row per path", async () => {
    await seed("a.md", [
      { index: 0, text: "alpha" },
      { index: 1, text: "alpha-2" },
    ]);
    await seed("b.md", [{ index: 0, text: "beta" }]);
    const summary = await listIndexedPaths(conn);
    expect(summary.map((s) => s.path).sort()).toEqual(["a.md", "b.md"]);
    expect(summary.find((s) => s.path === "a.md")?.chunk_count).toBe(2);
  });

  test("getIndexedPath returns the summary for a known path", async () => {
    await seed("a.md", [
      { index: 0, text: "x" },
      { index: 1, text: "y" },
    ]);
    const got = await getIndexedPath(conn, "a.md");
    expect(got).not.toBeNull();
    expect(got?.path).toBe("a.md");
    expect(got?.chunk_count).toBe(2);
  });

  test("indexStats reports unique paths and total chunks", async () => {
    await seed("a.md", [
      { index: 0, text: "x" },
      { index: 1, text: "y" },
    ]);
    await seed("b.md", [{ index: 0, text: "z" }]);
    const stats = await indexStats(conn);
    expect(stats.paths).toBe(2);
    expect(stats.chunks).toBe(3);
  });
});

describe("searchSemantic", () => {
  test("ranks paths whose chunks share words with the query higher", async () => {
    await seed("paternity.md", [
      { index: 0, text: "paternity leave parental time off newborn" },
    ]);
    await seed("revenue.md", [{ index: 0, text: "revenue forecast quota" }]);
    await seed("k8s.md", [
      { index: 0, text: "kubernetes helm deployment rollout" },
    ]);

    const queryVec = fakeEmbed("paternity leave plan childcare");
    const results = await searchSemantic(conn, queryVec, 10);
    expect(results[0]?.path).toBe("paternity.md");
  });

  test("respects the limit parameter", async () => {
    for (const path of ["a.md", "b.md", "c.md", "d.md"]) {
      await seed(path, [{ index: 0, text: `content-${path}` }]);
    }
    const queryVec = fakeEmbed("content");
    const results = await searchSemantic(conn, queryVec, 2);
    expect(results).toHaveLength(2);
  });
});

describe("searchKeyword (BM25)", () => {
  test("finds chunks by keyword once the FTS index is built", async () => {
    await seed("paternity.md", [
      { index: 0, text: "paternity leave parental time off newborn" },
    ]);
    await seed("k8s.md", [
      { index: 0, text: "kubernetes helm deployment rollout" },
    ]);
    await rebuildSearchIndex(conn);

    const results = await searchKeyword(conn, "paternity", 10);
    expect(results.map((r) => r.path)).toContain("paternity.md");
    // Only the paternity chunk matches "paternity"; k8s should be absent.
    expect(results.map((r) => r.path)).not.toContain("k8s.md");
  });

  test("returns the empty list when no chunks match the query", async () => {
    await seed("paternity.md", [{ index: 0, text: "paternity leave plan" }]);
    await rebuildSearchIndex(conn);

    const results = await searchKeyword(conn, "kubernetes", 10);
    expect(results).toEqual([]);
  });

  test("respects the limit parameter", async () => {
    for (const path of ["a.md", "b.md", "c.md"]) {
      await seed(path, [{ index: 0, text: "kubernetes deployment rollout" }]);
    }
    await rebuildSearchIndex(conn);
    const results = await searchKeyword(conn, "kubernetes", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("content-aware retrieval quality", () => {
  // The fakeEmbed in helpers.ts maps known vocab words (paternity, leave,
  // kubernetes, helm, …) to dedicated hot dimensions and unit-normalizes
  // the result, so cosine similarity tracks word overlap across docs.
  // These tests pin specific behaviors the original `hybridSearch end-to-end`
  // suite cared about: BM25 ranks more matching tokens higher, semantic
  // recall finds docs even with zero keyword overlap, and an unrelated
  // query does NOT surface a strong-on-other-tokens doc.

  test("BM25: a chunk matching more query tokens ranks higher than one matching fewer", async () => {
    await seed("strong.md", [
      { index: 0, text: "paternity leave parental time off newborn" },
    ]);
    await seed("weak.md", [{ index: 0, text: "paternity legal note only" }]);
    await rebuildSearchIndex(conn);

    const results = await searchKeyword(conn, "paternity leave parental", 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.path).toBe("strong.md");
  });

  test("semantic recall: a doc with zero query-token overlap is still retrieved by meaning", async () => {
    await seed("paternity.md", [
      { index: 0, text: "newborn parental time off childcare plan" },
    ]);
    await seed("revenue.md", [{ index: 0, text: "revenue forecast quota" }]);

    // Query has no literal overlap with paternity.md's chunk text.
    const queryVec = fakeEmbed("paternity leave");
    const results = await searchSemantic(conn, queryVec, 10);
    expect(results[0]?.path).toBe("paternity.md");
  });

  test("an unrelated query does NOT surface the paternity doc on top", async () => {
    await seed("paternity.md", [
      { index: 0, text: "paternity leave parental newborn" },
    ]);
    await seed("k8s.md", [
      { index: 0, text: "kubernetes helm deployment rollout" },
    ]);

    const queryVec = fakeEmbed("kubernetes deployment");
    const results = await searchSemantic(conn, queryVec, 10);
    // Semantic similarity on the kubernetes-themed query must rank k8s.md
    // ahead of the unrelated paternity doc.
    expect(results[0]?.path).toBe("k8s.md");
  });
});

describe("searchHybrid (RRF over BM25 + cosine)", () => {
  test("returns relevant chunks with a per-row score", async () => {
    await seed("paternity.md", [
      { index: 0, text: "paternity leave parental time off newborn" },
    ]);
    await seed("revenue.md", [{ index: 0, text: "revenue forecast quota" }]);
    await rebuildSearchIndex(conn);

    const queryVec = fakeEmbed("paternity leave plan childcare");
    const merged = await searchHybrid(conn, "paternity", queryVec, 10);
    // Top hit is the matching path; rows are deduped by (path, chunk_index).
    expect(merged[0]?.path).toBe("paternity.md");
    const seen = new Set(merged.map((r) => `${r.path}#${r.chunk_index}`));
    expect(seen.size).toBe(merged.length);
  });
});
