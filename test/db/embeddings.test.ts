import { beforeEach, describe, expect, test } from "bun:test";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
import {
  createEmbedding,
  deleteEmbeddingsForItem,
  hybridSearch,
  initVectorSearch,
  searchEmbeddings,
} from "../../src/db/embeddings.ts";
import { migrate } from "../../src/db/schema.ts";

let conn: DbConnection;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
  initVectorSearch(conn, 3); // 3-dim vectors for tests
});

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
    const emb = createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "some chunk text",
      title: "Test Item chunk 0",
      embedding: [0.1, 0.2, 0.3],
    });

    expect(emb.id).toBeTruthy();
    expect(emb.context_item_id).toBe(item.id);
    expect(emb.chunk_index).toBe(0);
    expect(emb.chunk_content).toBe("some chunk text");
    expect(emb.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test("stores embedding as BLOB in DB", async () => {
    const item = await makeContextItem("Blob Check");
    const emb = createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "chunk",
      title: "chunk 0",
      embedding: [1.0, 2.0, 3.0],
    });

    const row = conn
      .query("SELECT typeof(embedding) as t FROM embeddings WHERE id = ?1")
      .get(emb.id) as { t: string };
    expect(row.t).toBe("blob");
  });

  test("enforces unique (context_item_id, chunk_index)", async () => {
    const item = await makeContextItem("Unique Check");
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "first",
      title: "chunk 0",
      embedding: [1, 0, 0],
    });

    expect(() =>
      createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: 0,
        chunkContent: "duplicate",
        title: "chunk 0 dup",
        embedding: [0, 1, 0],
      }),
    ).toThrow();
  });
});

// ── deleteEmbeddingsForItem ────────────────────────────────

describe("deleteEmbeddingsForItem", () => {
  test("deletes all embeddings for a context item", async () => {
    const item = await makeContextItem("Delete Test");
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "chunk 0",
      title: "c0",
      embedding: [1, 0, 0],
    });
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "chunk 1",
      title: "c1",
      embedding: [0, 1, 0],
    });

    const deleted = deleteEmbeddingsForItem(conn, item.id);
    expect(deleted).toBe(2);

    const remaining = conn
      .query(
        "SELECT COUNT(*) as cnt FROM embeddings WHERE context_item_id = ?1",
      )
      .get(item.id) as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  test("returns 0 when no embeddings exist", () => {
    const deleted = deleteEmbeddingsForItem(conn, "nonexistent-id");
    expect(deleted).toBe(0);
  });

  test("does not delete embeddings for other items", async () => {
    const item1 = await makeContextItem("Item One");
    const item2 = await makeContextItem("Item Two");
    createEmbedding(conn, {
      contextItemId: item1.id,
      chunkIndex: 0,
      chunkContent: "chunk",
      title: "c",
      embedding: [1, 0, 0],
    });
    createEmbedding(conn, {
      contextItemId: item2.id,
      chunkIndex: 0,
      chunkContent: "chunk",
      title: "c",
      embedding: [0, 1, 0],
    });

    deleteEmbeddingsForItem(conn, item1.id);

    const remaining = conn
      .query("SELECT COUNT(*) as cnt FROM embeddings")
      .get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});

// ── searchEmbeddings ───────────────────────────────────────

describe("searchEmbeddings", () => {
  test("returns results ranked by cosine similarity", async () => {
    const item = await makeContextItem("Search Test");
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "close match",
      title: "close",
      embedding: [1, 0, 0],
    });
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "medium match",
      title: "medium",
      embedding: [0.7, 0.7, 0],
    });
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 2,
      chunkContent: "far match",
      title: "far",
      embedding: [0, 0, 1],
    });

    const results = searchEmbeddings(conn, [1, 0, 0], 10);
    expect(results.length).toBe(3);
    expect(results[0]?.chunk_content).toBe("close match");
    expect(results[0]?.score).toBeCloseTo(1.0);
    expect(results[2]?.chunk_content).toBe("far match");
    expect(results[2]?.score).toBeCloseTo(0.0);
  });

  test("respects limit", async () => {
    const item = await makeContextItem("Limit Test");
    for (let i = 0; i < 5; i++) {
      createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: i,
        chunkContent: `chunk ${i}`,
        title: `c${i}`,
        embedding: [Math.random(), Math.random(), Math.random()],
      });
    }

    const results = searchEmbeddings(conn, [1, 0, 0], 2);
    expect(results.length).toBe(2);
  });

  test("returns empty array when no embeddings exist", () => {
    const results = searchEmbeddings(conn, [1, 0, 0]);
    expect(results).toEqual([]);
  });
});

// ── hybridSearch ───────────────────────────────────────────

describe("hybridSearch", () => {
  test("combines keyword and vector results", async () => {
    const item = await makeContextItem("Hybrid Test");
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "quarterly revenue report",
      title: "revenue",
      embedding: [1, 0, 0],
    });
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 1,
      chunkContent: "annual revenue summary",
      title: "annual",
      embedding: [0, 0, 1],
    });
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 2,
      chunkContent: "financial overview",
      title: "overview",
      embedding: [0.9, 0.1, 0],
    });

    const results = hybridSearch(conn, "revenue", [1, 0, 0], 10);
    expect(results.length).toBe(3);
    expect(results[0]?.chunk_content).toBe("quarterly revenue report");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  test("returns keyword-only matches", async () => {
    const item = await makeContextItem("Keyword Only");
    createEmbedding(conn, {
      contextItemId: item.id,
      chunkIndex: 0,
      chunkContent: "the special keyword here",
      title: "special",
      embedding: [0, 0, 1],
    });

    const results = hybridSearch(conn, "special", [1, 0, 0], 10);
    expect(results.length).toBe(1);
    expect(results[0]?.chunk_content).toContain("special");
  });

  test("respects limit", async () => {
    const item = await makeContextItem("Limit Hybrid");
    for (let i = 0; i < 5; i++) {
      createEmbedding(conn, {
        contextItemId: item.id,
        chunkIndex: i,
        chunkContent: `match chunk ${i}`,
        title: `match ${i}`,
        embedding: [1, 0, 0],
      });
    }

    const results = hybridSearch(conn, "match", [1, 0, 0], 2);
    expect(results.length).toBe(2);
  });

  test("returns empty when nothing matches", () => {
    const results = hybridSearch(conn, "nonexistent", [1, 0, 0]);
    expect(results).toEqual([]);
  });
});
