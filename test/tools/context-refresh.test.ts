import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextRefreshTool } from "../../src/tools/context/refresh.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedFile, setupToolContext } from "../helpers.ts";

let ctx: ToolContext;
let tmpBase: string;

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
  tmpBase = join(
    tmpdir(),
    `botholomew-refresh-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await Bun.write(join(tmpBase, ".keep"), "");
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

async function seedFileBackedItem(
  filename: string,
  diskContent: string,
  storedContent: string,
) {
  const filePath = join(tmpBase, filename);
  await Bun.write(filePath, diskContent);
  const { createContextItem } = await import("../../src/db/context.ts");
  return createContextItem(ctx.conn, {
    title: filename,
    content: storedContent,
    contextPath: `/docs/${filename}`,
    mimeType: "text/plain",
    isTextual: true,
    sourceType: "file",
    sourcePath: filePath,
  });
}

describe("context_refresh tool", () => {
  test("errors when neither path nor all is provided", async () => {
    const result = await contextRefreshTool.execute({}, ctx);
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("path");
    expect(result.message).toContain("all");
  });

  test("errors when both path and all are provided", async () => {
    const result = await contextRefreshTool.execute(
      { path: "/x", all: true },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("mutually exclusive");
  });

  test("errors when path matches nothing", async () => {
    const result = await contextRefreshTool.execute(
      { path: "/no/such/thing" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("No context items");
  });

  test("returns informational success when matches have no source_path", async () => {
    await seedFile(ctx.conn, "/hand-written.md", "written in virtual fs");
    const result = await contextRefreshTool.execute(
      { path: "/hand-written.md" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.message).toContain("No matching items have a source_path");
  });

  test("updates a drifted file-backed item by path", async () => {
    const item = await seedFileBackedItem(
      "drift.md",
      "new disk content",
      "old stored content",
    );
    const result = await contextRefreshTool.execute({ path: item.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.items[0]?.status).toBe("updated");
  });

  test("reports unchanged when disk matches stored content", async () => {
    const item = await seedFileBackedItem("same.md", "identical", "identical");
    const result = await contextRefreshTool.execute({ path: item.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
  });

  test("all: true refreshes every sourced item", async () => {
    await seedFileBackedItem("a.md", "new a", "old a");
    await seedFileBackedItem("b.md", "same b", "same b");
    await seedFile(ctx.conn, "/no-source.md", "virtual fs only");

    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
  });

  test("path prefix matches a subtree of sourced items", async () => {
    await seedFileBackedItem("a.md", "new a", "old a");
    await seedFileBackedItem("b.md", "new b", "old b");

    const result = await contextRefreshTool.execute({ path: "/docs" }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.updated).toBe(2);
  });

  test("message surfaces embeddings_skipped when no OpenAI key", async () => {
    await seedFileBackedItem("drift2.md", "new", "old");

    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.reembedded).toBe(0);
    expect(result.embeddings_skipped).toBe(true);
    expect(result.message).toContain("embeddings skipped");
  });
});
