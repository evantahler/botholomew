import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";
import {
  ingestByPath,
  ingestContextItem,
  prepareIngestion,
} from "../../src/context/ingest.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItemById } from "../../src/db/context.ts";
import { searchEmbeddings } from "../../src/db/embeddings.ts";
import { setupTestDb } from "../helpers.ts";

const config = { ...DEFAULT_CONFIG };

/** Mock embedder that returns deterministic vectors without loading the real model. */
function mockEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const vec = new Array(EMBEDDING_DIMENSION).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % EMBEDDING_DIMENSION] += text.charCodeAt(i) / 1000;
      }
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
      drive: "agent",
      path: "/test/doc.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count).toBeGreaterThan(0);

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
      drive: "agent",
      path: "/test/indexed.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    expect(item.indexed_at).toBeNull();

    await ingestContextItem(conn, item.id, config, mockEmbed);

    const updated = await getContextItemById(conn, item.id);
    expect(updated?.indexed_at).not.toBeNull();
  });

  test("skips non-textual items", async () => {
    const item = await createContextItem(conn, {
      title: "binary file",
      drive: "agent",
      path: "/test/image.png",
      mimeType: "image/png",
      isTextual: false,
    });

    const count = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count).toBe(0);
  });

  test("skips items with no content", async () => {
    const item = await createContextItem(conn, {
      title: "empty file",
      drive: "agent",
      path: "/test/empty.md",
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
      drive: "agent",
      path: "/test/reindex.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count1 = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count1).toBeGreaterThan(0);

    const count2 = await ingestContextItem(conn, item.id, config, mockEmbed);
    expect(count2).toBe(count1);

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

describe("prepareIngestion", () => {
  test("prepends metadata to text sent to embedder", async () => {
    const item = await createContextItem(conn, {
      title: "My Report",
      description: "Quarterly revenue summary",
      content: "Some content to embed.",
      drive: "disk",
      path: "/home/user/report.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const capturedTexts: string[][] = [];
    const capturingEmbed = (texts: string[]): Promise<number[][]> => {
      capturedTexts.push(texts);
      return mockEmbed(texts);
    };

    const prepared = await prepareIngestion(
      conn,
      item.id,
      config,
      capturingEmbed,
    );

    expect(prepared).not.toBeNull();
    expect(capturedTexts).toHaveLength(1);

    const embeddedText = capturedTexts[0]?.[0];
    expect(embeddedText).toStartWith("Title: My Report\n");
    expect(embeddedText).toContain("Description: Quarterly revenue summary\n");
    expect(embeddedText).toContain("Source: disk:/home/user/report.md\n");
    expect(embeddedText).toContain("Some content to embed.");

    expect(prepared?.chunks[0]?.content).toBe("Some content to embed.");
  });
});

describe("ingestByPath", () => {
  test("ingests by (drive, path)", async () => {
    await createContextItem(conn, {
      title: "path test",
      content: "Content to find by path.",
      drive: "agent",
      path: "/notes/find-me.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const count = await ingestByPath(
      conn,
      { drive: "agent", path: "/notes/find-me.md" },
      config,
      mockEmbed,
    );
    expect(count).toBeGreaterThan(0);
  });

  test("returns 0 for non-existent path", async () => {
    const count = await ingestByPath(
      conn,
      { drive: "agent", path: "/no/such/path.md" },
      config,
      mockEmbed,
    );
    expect(count).toBe(0);
  });
});
