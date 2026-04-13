import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
import { migrate } from "../../src/db/schema.ts";
import { searchGrepTool } from "../../src/tools/search/grep.ts";
import { searchSemanticTool } from "../../src/tools/search/semantic.ts";
import type { AnyToolDefinition, ToolContext } from "../../src/tools/tool.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
  ctx = { conn, projectDir: "/tmp/test", config: { ...DEFAULT_CONFIG } };
});

async function seedFile(path: string, content: string) {
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    content,
    contextPath: path,
    mimeType: "text/plain",
    isTextual: true,
  });
}

// ── search_grep ─────────────────────────────────────────────

describe("search_grep", () => {
  test("finds a simple string match", async () => {
    await seedFile("/grep/hello.txt", "hello world\ngoodbye world");
    const result = await searchGrepTool.execute({ pattern: "hello" }, ctx);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.content).toContain("hello");
    expect(result.matches[0]?.path).toBe("/grep/hello.txt");
    expect(result.matches[0]?.line).toBe(1);
  });

  test("supports regex patterns", async () => {
    await seedFile("/grep/regex.txt", "foo123\nbar456\nfoo789");
    const result = await searchGrepTool.execute({ pattern: "foo\\d+" }, ctx);
    expect(result.matches.length).toBe(2);
  });

  test("case-insensitive search", async () => {
    await seedFile("/grep/case.txt", "Hello\nhello\nHELLO");
    const result = await searchGrepTool.execute(
      { pattern: "hello", ignore_case: true },
      ctx,
    );
    expect(result.matches.length).toBe(3);
  });

  test("case-sensitive by default", async () => {
    await seedFile("/grep/case2.txt", "Hello\nhello\nHELLO");
    const result = await searchGrepTool.execute({ pattern: "hello" }, ctx);
    expect(result.matches.length).toBe(1);
  });

  test("returns context lines", async () => {
    await seedFile("/grep/ctx.txt", "a\nb\nc\nd\ne");
    const result = await searchGrepTool.execute(
      { pattern: "c", context: 1 },
      ctx,
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.context_lines).toContain("b");
    expect(result.matches[0]?.context_lines).toContain("d");
  });

  test("respects max_results", async () => {
    await seedFile("/grep/many.txt", "match\nmatch\nmatch\nmatch\nmatch");
    const result = await searchGrepTool.execute(
      { pattern: "match", max_results: 2 },
      ctx,
    );
    expect(result.matches.length).toBe(2);
  });

  test("filters by glob pattern", async () => {
    await seedFile("/grep/code.ts", "function hello() {}");
    await seedFile("/grep/notes.md", "hello notes");
    const result = await searchGrepTool.execute(
      { pattern: "hello", glob: "*.ts" },
      ctx,
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.path).toBe("/grep/code.ts");
  });

  test("returns empty matches when nothing found", async () => {
    await seedFile("/grep/empty.txt", "no match here");
    const result = await searchGrepTool.execute({ pattern: "zzzzz" }, ctx);
    expect(result.matches).toHaveLength(0);
  });

  test("searches only within specified path", async () => {
    await seedFile("/a/file.txt", "target");
    await seedFile("/b/file.txt", "target");
    const result = await searchGrepTool.execute(
      { pattern: "target", path: "/a" },
      ctx,
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.path).toBe("/a/file.txt");
  });

  test("throws on invalid regex", async () => {
    await seedFile("/grep/test.txt", "test");
    expect(
      searchGrepTool.execute({ pattern: "[invalid" }, ctx),
    ).rejects.toThrow();
  });
});

// ── search_semantic ─────────────────────────────────────────

describe("search_semantic", () => {
  test("throws not yet available", async () => {
    const tool = searchSemanticTool as unknown as AnyToolDefinition;
    expect(tool.execute({ query: "anything", top_k: 10 }, ctx)).rejects.toThrow(
      "not yet available",
    );
  });
});
