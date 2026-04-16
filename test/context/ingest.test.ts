import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";
import { ingestByPath, ingestContextItem } from "../../src/context/ingest.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItem } from "../../src/db/context.ts";
import { searchEmbeddings } from "../../src/db/embeddings.ts";
import { setupTestDb } from "../helpers.ts";

const config = { ...DEFAULT_CONFIG };

/** Mock embedder that returns deterministic vectors without loading the real model. */
function mockEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      // Simple hash-based vector for deterministic results
      const vec = new Array(EMBEDDING_DIMENSION).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % EMBEDDING_DIMENSION] += text.charCodeAt(i) / 1000;
      }
      // Normalize
      const norm = Math.sqrt(
        vec.reduce((s: number, v: number) => s + v * v, 0),
      );
      return norm > 0 ? vec.map((v: number) => v / norm) : vec;
    }),
  );
}

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("ingestContextItem", () => {
  test("creates embeddings for textual content", async () => {
    const item = await createContextItem(conn, {
      title: "test doc",
      content: "This is a test document with some content.",
      contextPath: "/test/doc.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count).toBeGreaterThan(0);

    // Verify embeddings are stored
    const results = await searchEmbeddings(
      conn,
      await mockEmbed(["test"]).then((r) => r[0] ?? []),
      10,
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test("updates indexed_at timestamp", async () => {
    const item = await createContextItem(conn, {
      title: "indexed check",
      content: "Some content to index.",
      contextPath: "/test/indexed.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    expect(item.indexed_at).toBeNull();

    await ingestContextItem(conn, item.id, config, mockEmbed);

    const updated = await getContextItem(conn, item.id);
    expect(updated?.indexed_at).not.toBeNull();
  });

  test("skips non-textual items", async () => {
    const item = await createContextItem(conn, {
      title: "binary file",
      contextPath: "/test/image.png",
      mimeType: "image/png",
      isTextual: false,
    });

    const count = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count).toBe(0);
  });

  test("skips items with no content", async () => {
    const item = await createContextItem(conn, {
      title: "empty file",
      contextPath: "/test/empty.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count).toBe(0);
  });

  test("re-ingest clears old embeddings", async () => {
    const item = await createContextItem(conn, {
      title: "re-index test",
      content: "Original content for re-indexing.",
      contextPath: "/test/reindex.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count1 = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count1).toBeGreaterThan(0);

    // Re-ingest should not double the embeddings
    const count2 = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count2).toBe(count1);

    // Total embeddings should match the latest ingest
    const allResults = await searchEmbeddings(
      conn,
      await mockEmbed(["test"]).then((r) => r[0] ?? []),
      100,
    );
    expect(allResults.length).toBe(count2);
  });

  test("returns 0 for non-existent item", async () => {
    const count = await ingestContextItem(
      conn,
      "non-existent-id",
      config,
      mockEmbed,
    );
    expect(count).toBe(0);
  });
});

describe("ingestByPath", () => {
  test("ingests by virtual path", async () => {
    await createContextItem(conn, {
      title: "path test",
      content: "Content to find by path.",
      contextPath: "/notes/find-me.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count = await ingestByPath(
      conn,
      "/notes/find-me.md",
      config,
      mockEmbed,
    );
    expect(count).toBeGreaterThan(0);
  });

  test("returns 0 for non-existent path", async () => {
    const count = await ingestByPath(
      conn,
      "/no/such/path.md",
      config,
      mockEmbed,
    );
    expect(count).toBe(0);
  });
});
