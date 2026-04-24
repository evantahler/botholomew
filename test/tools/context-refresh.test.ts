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

/** Seed a disk-backed item: file on disk + row with drive='disk' path=<abs>. */
async function seedDiskItem(
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
    drive: "disk",
    path: filePath,
    mimeType: "text/plain",
    isTextual: true,
  });
}

describe("context_refresh tool", () => {
  test("errors when neither ref nor all is provided", async () => {
    const result = await contextRefreshTool.execute({}, ctx);
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("ref");
    expect(result.message).toContain("all");
  });

  test("errors when both ref and all are provided", async () => {
    const result = await contextRefreshTool.execute(
      { ref: "disk:/x", all: true },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("mutually exclusive");
  });

  test("errors when ref matches nothing", async () => {
    const result = await contextRefreshTool.execute(
      { ref: "disk:/no/such/thing" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.message).toContain("No context items");
  });

  test("returns informational success when matches are on drive=agent", async () => {
    await seedFile(ctx.conn, "/hand-written.md", "written in virtual fs");
    const result = await contextRefreshTool.execute(
      { ref: "agent:/hand-written.md" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.message).toContain("drive=agent");
  });

  test("updates a drifted disk item by id", async () => {
    const item = await seedDiskItem(
      "drift.md",
      "new disk content",
      "old stored content",
    );
    const result = await contextRefreshTool.execute({ ref: item.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.items[0]?.status).toBe("updated");
  });

  test("reports unchanged when disk matches stored content", async () => {
    const item = await seedDiskItem("same.md", "identical", "identical");
    const result = await contextRefreshTool.execute({ ref: item.id }, ctx);

    expect(result.is_error).toBe(false);
    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
  });

  test("all: true refreshes every non-agent item", async () => {
    await seedDiskItem("a.md", "new a", "old a");
    await seedDiskItem("b.md", "same b", "same b");
    await seedFile(ctx.conn, "/no-source.md", "virtual fs only");

    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
  });

  test("drive:/prefix matches a subtree of disk items", async () => {
    await seedDiskItem("a.md", "new a", "old a");
    await seedDiskItem("b.md", "new b", "old b");

    const result = await contextRefreshTool.execute(
      { ref: `disk:${tmpBase}` },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.updated).toBe(2);
  });

  test("message surfaces embeddings_skipped when no OpenAI key", async () => {
    await seedDiskItem("drift2.md", "new", "old");

    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.reembedded).toBe(0);
    expect(result.embeddings_skipped).toBe(true);
    expect(result.message).toContain("embeddings skipped");
  });

  test("returns a tree snapshot on successful refresh", async () => {
    await seedDiskItem("drift.md", "new disk content", "old stored");
    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.tree).toBeTruthy();
  });

  test("all: true renders the top-level drive summary, not a single drive", async () => {
    await seedDiskItem("doc.md", "new disk content", "old stored");
    await seedFile(ctx.conn, { drive: "agent", path: "/scratch.md" }, "s");
    const result = await contextRefreshTool.execute({ all: true }, ctx);
    expect(result.is_error).toBe(false);
    // The summary tree lists both drives that have content, not just `disk:/`.
    expect(result.tree).toContain("Drives:");
    expect(result.tree).toContain("disk:/");
    expect(result.tree).toContain("agent:/");
  });
});
