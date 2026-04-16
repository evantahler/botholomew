import { beforeEach, describe, expect, test } from "bun:test";
import { contextSearchTool } from "../../src/tools/context/search.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedFile, setupToolContext } from "../helpers.ts";

let ctx: ToolContext;

beforeEach(async () => {
  ({ ctx } = await setupToolContext());
});

describe("context_search", () => {
  test("returns empty results for no matches", async () => {
    const result = await contextSearchTool.execute(
      { query: "nonexistent" },
      ctx,
    );
    expect(result.results).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("finds items by content", async () => {
    await seedFile(
      ctx.conn,
      "/notes/meeting.md",
      "Discussed quarterly revenue",
    );
    const result = await contextSearchTool.execute({ query: "revenue" }, ctx);
    expect(result.count).toBe(1);
    expect(result.results[0]?.context_path).toBe("/notes/meeting.md");
  });

  test("finds items by title", async () => {
    await seedFile(ctx.conn, "/reports/budget.md", "Numbers here", {
      title: "Budget Report",
    });
    const result = await contextSearchTool.execute({ query: "budget" }, ctx);
    expect(result.count).toBe(1);
  });

  test("respects limit", async () => {
    await seedFile(ctx.conn, "/a.md", "test content");
    await seedFile(ctx.conn, "/b.md", "test content");
    await seedFile(ctx.conn, "/c.md", "test content");
    const result = await contextSearchTool.execute(
      { query: "test", limit: 2 },
      ctx,
    );
    expect(result.count).toBe(2);
  });

  test("returns content preview", async () => {
    await seedFile(ctx.conn, "/doc.md", "A very long document about testing");
    const result = await contextSearchTool.execute({ query: "testing" }, ctx);
    expect(result.results[0]?.content_preview).toContain("testing");
  });
});
