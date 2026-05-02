import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";

// Mock the embedder before importing reembed.ts so the import binding picks
// up the mock. Returning a deterministic non-zero vector lets tests verify
// that vectors actually flow from embed() into the embeddings table.
const embedMock = mock(async (texts: string[]) =>
  texts.map((_, i) => {
    const v = new Array(EMBEDDING_DIMENSION).fill(0);
    v[i % EMBEDDING_DIMENSION] = 1;
    return v;
  }),
);
const embedSingleMock = mock(async () => {
  const v = new Array(EMBEDDING_DIMENSION).fill(0);
  v[0] = 1;
  return v;
});

mock.module("../../src/context/embedder.ts", () => ({
  embed: embedMock,
  embedSingle: embedSingleMock,
}));

const { TEST_CONFIG, setupTestDbFile } = await import("../helpers.ts");
const { uuidv7 } = await import("../../src/db/uuid.ts");
const { withDb } = await import("../../src/db/connection.ts");
const { reembedMissingVectors } = await import("../../src/db/reembed.ts");
const { createContextItem } = await import("../../src/db/context.ts");

let dbPath: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  embedMock.mockClear();
  embedSingleMock.mockClear();
  ({ dbPath, cleanup } = await setupTestDbFile());
});

afterEach(async () => {
  await cleanup();
});

async function seedNullEmbedding(
  itemId: string,
  chunkIndex: number,
  chunkContent: string,
  title: string,
): Promise<string> {
  const id = uuidv7();
  await withDb(dbPath, (conn) =>
    conn.queryRun(
      `INSERT INTO embeddings (id, context_item_id, chunk_index, chunk_content, title, description, embedding)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
      id,
      itemId,
      chunkIndex,
      chunkContent,
      title,
      "",
    ),
  );
  return id;
}

async function seedItem(title: string, path: string): Promise<string> {
  return withDb(dbPath, async (conn) => {
    const item = await createContextItem(conn, {
      title,
      content: "",
      drive: "agent",
      path,
      mimeType: "text/plain",
      isTextual: true,
    });
    return item.id;
  });
}

describe("reembedMissingVectors", () => {
  test("populates NULL embeddings and leaves no NULL rows", async () => {
    const itemId = await seedItem("Doc A", "/a.md");
    const e1 = await seedNullEmbedding(itemId, 0, "first chunk", "Doc A");
    const e2 = await seedNullEmbedding(itemId, 1, "second chunk", "Doc A");

    await reembedMissingVectors(dbPath, TEST_CONFIG);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0]?.[0]).toHaveLength(2);

    const rows = await withDb(dbPath, (conn) =>
      conn.queryAll<{ id: string; embedding: number[] | null }>(
        "SELECT id, embedding FROM embeddings WHERE id IN (?1, ?2) ORDER BY chunk_index",
        e1,
        e2,
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.embedding).not.toBeNull();
    expect(rows[1]?.embedding).not.toBeNull();
    expect(rows[0]?.embedding).toHaveLength(EMBEDDING_DIMENSION);
    expect(rows[1]?.embedding).toHaveLength(EMBEDDING_DIMENSION);

    const remaining = await withDb(dbPath, (conn) =>
      conn.queryGet<{ count: number }>(
        "SELECT count(*)::INTEGER AS count FROM embeddings WHERE embedding IS NULL",
      ),
    );
    expect(remaining?.count).toBe(0);
  });

  test("is a no-op when nothing is NULL", async () => {
    await reembedMissingVectors(dbPath, TEST_CONFIG);
    expect(embedMock).not.toHaveBeenCalled();
  });

  test("includes title, description, and source ref in embed input", async () => {
    const itemId = await seedItem("My Doc", "/notes/a.md");
    await seedNullEmbedding(itemId, 0, "chunk content here", "My Doc");

    await reembedMissingVectors(dbPath, TEST_CONFIG);

    const inputs = embedMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(inputs).toBeDefined();
    expect(inputs?.[0]).toContain("Title: My Doc");
    expect(inputs?.[0]).toContain("Source: agent:/notes/a.md");
    expect(inputs?.[0]).toContain("chunk content here");
  });

  test("mode: 'all' re-embeds rows that already have vectors", async () => {
    const itemId = await seedItem("Doc B", "/b.md");
    const id = uuidv7();
    const oldVec = new Array(EMBEDDING_DIMENSION).fill(0);
    oldVec[100] = 1; // distinguishable from the mock's hot dim (index 0)
    await withDb(dbPath, (conn) =>
      conn.queryRun(
        `INSERT INTO embeddings (id, context_item_id, chunk_index, chunk_content, title, description, embedding)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7::FLOAT[${EMBEDDING_DIMENSION}])`,
        id,
        itemId,
        0,
        "old content",
        "Doc B",
        "",
        oldVec,
      ),
    );

    await reembedMissingVectors(dbPath, TEST_CONFIG, { mode: "all" });

    expect(embedMock).toHaveBeenCalledTimes(1);
    const row = await withDb(dbPath, (conn) =>
      conn.queryGet<{ embedding: number[] }>(
        "SELECT embedding FROM embeddings WHERE id = ?1",
        id,
      ),
    );
    // Mock writes 1 at index 0; old vector had 1 at index 100. If reembed
    // overwrote, index 0 is now 1 and index 100 is 0.
    expect(row?.embedding[0]).toBe(1);
    expect(row?.embedding[100]).toBe(0);
  });

  test("processes batches larger than the batch size", async () => {
    const itemId = await seedItem("Big Doc", "/big.md");
    const N = 50; // > BATCH_SIZE (32)
    for (let i = 0; i < N; i++) {
      await seedNullEmbedding(itemId, i, `chunk ${i}`, "Big Doc");
    }

    await reembedMissingVectors(dbPath, TEST_CONFIG);

    expect(embedMock).toHaveBeenCalledTimes(2); // 32 + 18
    const remaining = await withDb(dbPath, (conn) =>
      conn.queryGet<{ count: number }>(
        "SELECT count(*)::INTEGER AS count FROM embeddings WHERE embedding IS NULL",
      ),
    );
    expect(remaining?.count).toBe(0);
  });
});
