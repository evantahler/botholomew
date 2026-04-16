import { beforeEach, describe, expect, test } from "bun:test";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
import {
  createEmbedding,
  deleteEmbeddingsForItem,
  hybridSearch,
  searchEmbeddings,
} from "../../src/db/embeddings.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

/** Create a 384-dim vector with a value at the given index */
function vec(index: number, value = 1): number[] {
  const v = new Array(EMBEDDING_DIMENSION).fill(0);
  v[index] = value;
  return v;
}

/** Create a 384-dim vector from a few leading values */
function vecFrom(...values: number[]): number[] {
  const v = new Array(EMBEDDING_DIMENSION).fill(0);
  for (let i = 0; i < values.length; i++) v[i] = values[i] ?? 0;
  return v;
}

async function makeContextItem(title: string) {
  return await createContextItem(conn, {
    title,
    content: `Content for ${title}`,
    contextPath: `/${title.toLowerCase().replace(/\s+/g, "-")}`,
    mimeType: "text/plain",
    isTextual: true,
  });
}

// ── createEmbedding ────────────────────────────────────────

describe("createEmbedding", () => {
  test("inserts an embedding row", async () => {
    const item = await makeContextItem("Test Item");
    const emb = await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "some chunk text",
      title: "Test Item chunk 0",
      embedding: vecFrom(0.1, 0.2, 0.3),
    });

    expect(emb.id).toBeTruthy();
    expect(emb.context_item_id).toBe(item.id);
    expect(emb.chunk_index).toBe(0);
    expect(emb.chunk_content).toBe("some chunk text");
    expect(emb.embedding.length).toBe(EMBEDDING_DIMENSION);
  });

  test("enforces unique (context_item_id, chunk_index)", async () => {
    const item = await makeContextItem("Unique Check");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "first",
      title: "chunk 0",
      embedding: vec(0),
    });

    expect(
      createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: 0,
        chunkContent: "duplicate",
        title: "chunk 0 dup",
        embedding: vec(1),
      }),
    ).rejects.toThrow();
  });
});

// ── deleteEmbeddingsForItem ────────────────────────────────

describe("deleteEmbeddingsForItem", () => {
  test("deletes all embeddings for a context item", async () => {
    const item = await makeContextItem("Delete Test");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "chunk 0",
      title: "c0",
      embedding: vec(0),
    });
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "chunk 1",
      title: "c1",
      embedding: vec(1),
    });

    const deleted = await deleteEmbeddingsForItem(conn, item.id);
    expect(deleted).toBe(2);

    const remaining = (await conn.queryGet(
      "SELECT COUNT(*) as cnt FROM embeddings WHERE context_item_id = ?1",
      item.id,
    )) as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  test("returns 0 when no embeddings exist", async () => {
    const deleted = await deleteEmbeddingsForItem(conn, "nonexistent-id");
    expect(deleted).toBe(0);
  });

  test("does not delete embeddings for other items", async () => {
    const item1 = await makeContextItem("Item One");
    const item2 = await makeContextItem("Item Two");
    await createEmbedding(conn, {
      contextItemId: item1.id,
      chunkIndex: 0,
      chunkContent: "chunk",
      title: "c",
      embedding: vec(0),
    });
    await createEmbedding(conn, {
      contextItemId: item2.id,
      chunkIndex: 0,
      chunkContent: "chunk",
      title: "c",
      embedding: vec(1),
    });

    await deleteEmbeddingsForItem(conn, item1.id);

    const remaining = (await conn.queryGet(
      "SELECT COUNT(*) as cnt FROM embeddings",
    )) as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});

// ── searchEmbeddings ───────────────────────────────────────

describe("searchEmbeddings", () => {
  test("returns results ranked by cosine similarity", async () => {
    const item = await makeContextItem("Search Test");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "close match",
      title: "close",
      embedding: vec(0),
    });
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "medium match",
      title: "medium",
      embedding: vecFrom(0.7, 0.7),
    });
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 2,
      chunkContent: "far match",
      title: "far",
      embedding: vec(2),
    });

    const results = await searchEmbeddings(conn, vec(0), 10);
    expect(results.length).toBe(3);
    expect(results[0]?.chunk_content).toBe("close match");
    expect(results[0]?.score).toBeCloseTo(1.0);
    expect(results[2]?.chunk_content).toBe("far match");
    expect(results[2]?.score).toBeCloseTo(0.0);
  });

  test("respects limit", async () => {
    const item = await makeContextItem("Limit Test");
    for (let i = 0; i < 5; i++) {
      await createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: i,
        chunkContent: `chunk ${i}`,
        title: `c${i}`,
        embedding: vecFrom(Math.random(), Math.random(), Math.random()),
      });
    }

    const results = await searchEmbeddings(conn, vec(0), 2);
    expect(results.length).toBe(2);
  });

  test("returns empty array when no embeddings exist", async () => {
    const results = await searchEmbeddings(conn, vec(0));
    expect(results).toEqual([]);
  });
});

// ── hybridSearch ───────────────────────────────────────────

describe("hybridSearch", () => {
  test("combines keyword and vector results", async () => {
    const item = await makeContextItem("Hybrid Test");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "quarterly revenue report",
      title: "revenue",
      embedding: vec(0),
    });
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "annual revenue summary",
      title: "annual",
      embedding: vec(2),
    });
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 2,
      chunkContent: "financial overview",
      title: "overview",
      embedding: vecFrom(0.9, 0.1),
    });

    const results = await hybridSearch(conn, "revenue", vec(0), 10);
    expect(results.length).toBe(3);
    expect(results[0]?.chunk_content).toBe("quarterly revenue report");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  test("returns keyword-only matches", async () => {
    const item = await makeContextItem("Keyword Only");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "the special keyword here",
      title: "special",
      embedding: vec(2),
    });

    const results = await hybridSearch(conn, "special", vec(0), 10);
    expect(results.length).toBe(1);
    expect(results[0]?.chunk_content).toContain("special");
  });

  test("respects limit", async () => {
    const item = await makeContextItem("Limit Hybrid");
    for (let i = 0; i < 5; i++) {
      await createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: i,
        chunkContent: `match chunk ${i}`,
        title: `match ${i}`,
        embedding: vec(0),
      });
    }

    const results = await hybridSearch(conn, "match", vec(0), 2);
    expect(results.length).toBe(2);
  });

  test("returns empty when nothing matches", async () => {
    const results = await hybridSearch(conn, "nonexistent", vec(0));
    expect(results).toEqual([]);
  });
});

// ── Edge cases ────────────────────────────────────────────

describe("edge cases", () => {
  test("search with large number of embeddings respects limit", async () => {
    const item = await makeContextItem("Many Embeddings");
    for (let i = 0; i < 20; i++) {
      await createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: i,
        chunkContent: `chunk ${i}`,
        title: `c${i}`,
        embedding: vecFrom(Math.cos(i), Math.sin(i)),
      });
    }

    const results5 = await searchEmbeddings(conn, vec(0), 5);
    expect(results5.length).toBe(5);

    const results10 = await searchEmbeddings(conn, vec(0), 10);
    expect(results10.length).toBe(10);
  });

  test("embeddings from different items are returned in search", async () => {
    const item1 = await makeContextItem("Item One");
    const item2 = await makeContextItem("Item Two");

    await createEmbedding(conn, {
      contextItemId: item1.id,
      chunkIndex: 0,
      chunkContent: "first item content",
      title: "first",
      embedding: vec(0),
    });

    await createEmbedding(conn, {
      contextItemId: item2.id,
      chunkIndex: 0,
      chunkContent: "second item content",
      title: "second",
      embedding: vecFrom(0.9, 0.1),
    });

    const results = await searchEmbeddings(conn, vec(0), 10);
    expect(results.length).toBe(2);
    const itemIds = results.map((r) => r.context_item_id);
    expect(itemIds).toContain(item1.id);
    expect(itemIds).toContain(item2.id);
  });

  test("hybrid search deduplicates results found by both keyword and vector", async () => {
    const item = await makeContextItem("Dedup Test");
    await createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "unique keyword content",
      title: "unique",
      embedding: vec(0),
    });

    // Search with keyword that matches AND vector that matches
    const results = await hybridSearch(conn, "unique", vec(0), 10);
    expect(results.length).toBe(1);
    // Score should be boosted by appearing in both keyword and vector results
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});
