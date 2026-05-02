import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import type { FetchedContent } from "../../src/context/fetcher.ts";
import type { FetchUrlFn } from "../../src/context/refresh.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { createContextItem, getContextItemById } from "../../src/db/context.ts";
import { mockEmbed, setupTestDb } from "../helpers.ts";

const config = { ...DEFAULT_CONFIG };

let conn: DbConnection;
let tmpBase: string;

/** Build a fake fetcher that records every URL it's called with. */
function makeFakeFetchFn(reply: (url: string) => FetchedContent): {
  fn: FetchUrlFn;
  calls: string[];
} {
  const calls: string[] = [];
  const fn: FetchUrlFn = async (url) => {
    calls.push(url);
    return reply(url);
  };
  return { fn, calls };
}

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

  test("errors when drive is unknown and source_url is null", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const item = await createContextItem(conn, {
      title: "unknown service doc",
      content: "stored",
      drive: "notion",
      path: "/abc123",
      mimeType: "text/markdown",
      isTextual: true,
    });

    const { fn, calls } = makeFakeFetchFn(() => {
      throw new Error("fetchFn should not be called");
    });

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
      fn,
    );

    expect(result.items[0]?.status).toBe("error");
    expect(result.items[0]?.error).toMatch(/no source_url/);
    expect(result.items[0]?.error).toContain("notion:/abc123");
    expect(calls).toHaveLength(0);
  });
});

describe("refreshContextItems — service drives", () => {
  test("google-docs refresh uses source_url when present", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const gdoc = await createContextItem(conn, {
      title: "some doc",
      content: "stale",
      drive: "google-docs",
      path: "/abc123",
      mimeType: "text/markdown",
      isTextual: true,
      sourceUrl: "https://docs.google.com/document/d/abc123/edit",
    });

    const { fn, calls } = makeFakeFetchFn((url) => ({
      title: "some doc",
      content: "fresh content",
      mimeType: "text/markdown",
      sourceUrl: url,
      drive: "google-docs",
      path: "/abc123",
    }));

    const result = await refreshContextItems(
      conn,
      [gdoc],
      config,
      null,
      {},
      mockEmbed,
      fn,
    );

    expect(calls).toEqual(["https://docs.google.com/document/d/abc123/edit"]);
    expect(result.items[0]?.status).toBe("updated");
    expect(result.updated).toBe(1);
    expect(result.reembedded).toBe(1);

    const fresh = await getContextItemById(conn, gdoc.id);
    expect(fresh?.content).toBe("fresh content");
  });

  test("service-drive refresh errors when source_url is null (no remote-service reconstruction)", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const legacy = await createContextItem(conn, {
      title: "legacy doc",
      content: "stale",
      drive: "google-docs",
      path: "/legacy-id",
      mimeType: "text/markdown",
      isTextual: true,
    });

    const { fn, calls } = makeFakeFetchFn(() => {
      throw new Error("fetchFn should not be called without source_url");
    });

    const result = await refreshContextItems(
      conn,
      [legacy],
      config,
      null,
      {},
      mockEmbed,
      fn,
    );

    expect(calls).toHaveLength(0);
    expect(result.items[0]?.status).toBe("error");
    expect(result.items[0]?.error).toMatch(/no source_url/);
  });

  test("url-drive refresh passes the stored URL through fetchFn", async () => {
    const { refreshContextItems } = await import(
      "../../src/context/refresh.ts"
    );
    const item = await createContextItem(conn, {
      title: "example",
      content: "stale",
      drive: "url",
      path: "/https://example.com/post",
      mimeType: "text/markdown",
      isTextual: true,
    });

    const { fn, calls } = makeFakeFetchFn((url) => ({
      title: "example",
      content: "stale", // unchanged
      mimeType: "text/markdown",
      sourceUrl: url,
      drive: "url",
      path: "/https://example.com/post",
    }));

    const result = await refreshContextItems(
      conn,
      [item],
      config,
      null,
      {},
      mockEmbed,
      fn,
    );

    expect(calls).toEqual(["https://example.com/post"]);
    expect(result.items[0]?.status).toBe("unchanged");
  });
});
