import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItemById } from "../../src/db/context.ts";
import { mockEmbed, setupTestDb } from "../helpers.ts";

const config = { ...DEFAULT_CONFIG, openai_api_key: "test-key" };
const configNoEmbed = { ...DEFAULT_CONFIG };

let conn: DbConnection;
let tmpBase: string;

beforeEach(async () => {
  conn = await setupTestDb();
  tmpBase = join(
    tmpdir(),
    `botholomew-refresh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await Bun.write(join(tmpBase, ".keep"), "");
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

async function seedDiskItem(params: {
  filePath: string;
  initialDiskContent: string;
  storedContent: string;
}) {
  await Bun.write(params.filePath, params.initialDiskContent);
  return createContextItem(conn, {
    title: params.filePath.split("/").pop() ?? "item",
    content: params.storedContent,
    drive: "disk",
    path: params.filePath,
    mimeType: "text/plain",
    isTextual: true,
  });
}

describe("refreshContextItems — disk drive", () => {
  test("updates content and re-embeds when disk changed", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const filePath = join(tmpBase, "doc.md");
    const item = await seedDiskItem({
      filePath,
      initialDiskContent: "new content",
      storedContent: "old content",
    });

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.checked).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.missing).toBe(0);
    expect(result.reembedded).toBe(1);
    expect(result.chunks).toBeGreaterThan(0);

    const fresh = await getContextItemById(conn, item.id);
    expect(fresh?.content).toBe("new content");
    expect(fresh?.indexed_at).not.toBeNull();
  });

  test("reports unchanged when disk matches stored content", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const filePath = join(tmpBase, "same.md");
    const item = await seedDiskItem({
      filePath,
      initialDiskContent: "identical",
      storedContent: "identical",
    });

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.reembedded).toBe(0);
  });

  test("reports missing when source file no longer exists", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const filePath = join(tmpBase, "gone.md");
    const item = await seedDiskItem({
      filePath,
      initialDiskContent: "will be deleted",
      storedContent: "will be deleted",
    });
    await rm(filePath);

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.missing).toBe(1);
    expect(result.items[0]?.status).toBe("missing");
  });

  test("skips embeddings and flags embeddings_skipped when no OpenAI key", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const filePath = join(tmpBase, "noembed.md");
    const item = await seedDiskItem({
      filePath,
      initialDiskContent: "drifted",
      storedContent: "original",
    });

    const result = await refreshContextItems(conn, [item], configNoEmbed, null);

    expect(result.updated).toBe(1);
    expect(result.reembedded).toBe(0);
    expect(result.embeddings_skipped).toBe(true);

    const fresh = await getContextItemById(conn, item.id);
    expect(fresh?.content).toBe("drifted");
  });

  test("skips items on drive=agent", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const agent = await createContextItem(conn, {
      title: "agent-only",
      content: "no external origin",
      drive: "agent",
      path: "/docs/untethered.md",
      mimeType: "text/plain",
      isTextual: true,
    });

    const result = await refreshContextItems(
      conn,
      [agent],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.checked).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test("calls progress callbacks", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const filePath = join(tmpBase, "progress.md");
    const item = await seedDiskItem({
      filePath,
      initialDiskContent: "changed",
      storedContent: "original",
    });

    const itemProgress: Array<[number, number]> = [];
    const embedProgress: Array<[number, number]> = [];

    await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {
        onItemProgress: (d, t) => itemProgress.push([d, t]),
        onEmbedProgress: (d, t) => embedProgress.push([d, t]),
      },
      mockEmbed,
    );

    expect(itemProgress.at(-1)).toEqual([1, 1]);
    expect(embedProgress.at(-1)).toEqual([1, 1]);
  });
});

describe("refreshContextItems — error handling", () => {
  test("records per-item error when source read throws", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    // Point disk path at a directory; Bun.file().text() will throw when reading.
    const item = await createContextItem(conn, {
      title: "bad source",
      content: "stored",
      drive: "disk",
      path: tmpBase,
      mimeType: "text/plain",
      isTextual: true,
    });

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.updated).toBe(0);
    const statuses = result.items.map((i) => i.status);
    expect(statuses).toSatisfy(
      (s) => s.includes("error") || s.includes("missing"),
    );
  });

  test("errors for service-drive items (refresh not implemented)", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const gdoc = await createContextItem(conn, {
      title: "some doc",
      content: "stored",
      drive: "google-docs",
      path: "/abc123",
      mimeType: "text/markdown",
      isTextual: true,
    });

    const result = await refreshContextItems(
      conn,
      [gdoc],
      config,
      null,
      {},
      mockEmbed,
    );

    expect(result.items[0]?.status).toBe("error");
    expect(result.items[0]?.error).toContain("google-docs");
  });
});
