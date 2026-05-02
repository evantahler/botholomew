import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EMBEDDING_DIMENSION } from "../../src/constants.ts";
import { ingestContextItem } from "../../src/context/ingest.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import { searchTool } from "../../src/tools/search/index.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedFile, setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

const originalFetch = globalThis.fetch;
beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("search — regexp side", () => {
  test("finds a simple string match", async () => {
    await seedFile(conn, "/grep/hello.txt", "hello world\ngoodbye world");
    const result = await searchTool.execute({ pattern: "hello" }, ctx);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.content).toContain("hello");
    expect(result.matches[0]?.path).toBe("/grep/hello.txt");
    expect(result.matches[0]?.line).toBe(1);
    expect(result.matches[0]?.match_type).toBe("regexp");
    expect(result.matches[0]?.semantic_score).toBeNull();
  });

  test("supports regex patterns", async () => {
    await seedFile(conn, "/grep/regex.txt", "foo123\nbar456\nfoo789");
    const result = await searchTool.execute({ pattern: "foo\\d+" }, ctx);
    expect(result.matches.length).toBe(2);
  });

  test("case-insensitive search", async () => {
    await seedFile(conn, "/grep/case.txt", "Hello\nhello\nHELLO");
    const result = await searchTool.execute(
      { pattern: "hello", ignore_case: true },
      ctx,
    );
    expect(result.matches.length).toBe(3);
  });

  test("case-sensitive by default", async () => {
    await seedFile(conn, "/grep/case2.txt", "Hello\nhello\nHELLO");
    const result = await searchTool.execute({ pattern: "hello" }, ctx);
    expect(result.matches.length).toBe(1);
  });

  test("returns context lines", async () => {
    await seedFile(conn, "/grep/ctx.txt", "a\nb\nc\nd\ne");
    const result = await searchTool.execute({ pattern: "c", context: 1 }, ctx);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.context_lines).toContain("b");
    expect(result.matches[0]?.context_lines).toContain("d");
  });

  test("respects max_results", async () => {
    await seedFile(conn, "/grep/many.txt", "match\nmatch\nmatch\nmatch\nmatch");
    const result = await searchTool.execute(
      { pattern: "match", max_results: 2 },
      ctx,
    );
    expect(result.matches.length).toBe(2);
  });

  test("filters by glob pattern", async () => {
    await seedFile(conn, "/grep/code.ts", "function hello() {}");
    await seedFile(conn, "/grep/notes.md", "hello notes");
    const result = await searchTool.execute(
      { pattern: "hello", glob: "*.ts" },
      ctx,
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.path).toBe("/grep/code.ts");
  });

  test("returns empty matches when nothing found", async () => {
    await seedFile(conn, "/grep/empty.txt", "no match here");
    const result = await searchTool.execute({ pattern: "zzzzz" }, ctx);
    expect(result.matches).toHaveLength(0);
  });

  test("searches only within specified drive and path", async () => {
    await seedFile(conn, "/a/file.txt", "target");
    await seedFile(conn, "/b/file.txt", "target");
    const result = await searchTool.execute(
      { pattern: "target", drive: "agent", path: "/a" },
      ctx,
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.path).toBe("/a/file.txt");
  });

  test("errors when `path` is passed without `drive`", async () => {
    await seedFile(conn, "/a/file.txt", "target");
    const result = await searchTool.execute(
      { pattern: "target", path: "/a" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_arguments");
    expect(result.matches).toHaveLength(0);
  });

  test("throws on invalid regex", async () => {
    await seedFile(conn, "/grep/test.txt", "test");
    expect(searchTool.execute({ pattern: "[invalid" }, ctx)).rejects.toThrow();
  });
});

describe("search — input validation", () => {
  test("errors when neither query nor pattern is provided", async () => {
    const result = await searchTool.execute({}, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_arguments");
    expect(result.message).toContain("query");
    expect(result.message).toContain("pattern");
    expect(result.matches).toHaveLength(0);
  });
});

describe("search — semantic side", () => {
  test("returns results for indexed content", async () => {
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

    const item = await seedFile(
      conn,
      "/search/doc.md",
      "Meeting notes about quarterly revenue and projections.",
    );
    await ingestContextItem(conn, item.id, ctx.config, mockEmbed);

    const queryVec = await mockEmbed(["quarterly revenue"]).then(
      (r) => r[0] ?? [],
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: queryVec, index: 0 }],
            usage: { total_tokens: 5 },
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await searchTool.execute(
      { query: "quarterly revenue" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.match_type).toBe("semantic");
    expect(result.matches[0]?.line).toBeNull();
    expect(result.matches[0]?.semantic_score).not.toBeNull();
  });
});

describe("search — fusion (regexp + semantic)", () => {
  test("a chunk hit by both regexp and semantic gets match_type 'both' and floats to top", async () => {
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

    // Two files, but only one has the literal "quarterly revenue" string
    // AND is what the embedder will rank highest for that query.
    const matched = await seedFile(
      conn,
      "/search/match.md",
      "Quarterly revenue grew 12% last period.",
    );
    const unrelated = await seedFile(
      conn,
      "/search/unrelated.md",
      "Coffee preferences across the team.",
    );
    await ingestContextItem(conn, matched.id, ctx.config, mockEmbed);
    await ingestContextItem(conn, unrelated.id, ctx.config, mockEmbed);

    const queryVec = await mockEmbed(["quarterly revenue"]).then(
      (r) => r[0] ?? [],
    );
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: queryVec, index: 0 }],
            usage: { total_tokens: 5 },
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await searchTool.execute(
      { query: "quarterly revenue", pattern: "Quarterly revenue" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    // The matched.md entry should be top-ranked with match_type "both"
    const top = result.matches[0];
    expect(top?.path).toBe("/search/match.md");
    expect(top?.match_type).toBe("both");
    expect(top?.line).toBe(1);
    expect(top?.semantic_score).not.toBeNull();
  });
});
