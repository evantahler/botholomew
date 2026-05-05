import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { CONTEXT_DIR } from "../../src/constants.ts";
import { searchTool } from "../../src/tools/search/index.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

// Regexp-only coverage. Semantic tests would require booting the WASM
// embedder, which is slow and a poor fit for unit tests; the embedder
// itself is covered in test/context/embedder.test.ts.

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "both-search-"));
  await mkdir(join(tempDir, CONTEXT_DIR), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    conn: null as never,
    dbPath: ":memory:",
    projectDir: tempDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
}

describe("search tool", () => {
  test("requires query or pattern", async () => {
    const result = await searchTool.execute({}, ctx());
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_arguments");
  });

  test("regexp finds line hits with file path and line number", async () => {
    await Bun.write(
      join(tempDir, CONTEXT_DIR, "notes.md"),
      "alpha line\nthe revenue forecast is up\ngamma line\n",
    );
    const result = await searchTool.execute({ pattern: "revenue" }, ctx());
    expect(result.is_error).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    const hit = result.matches[0];
    if (!hit) throw new Error("no hit");
    expect(hit.path).toBe("notes.md");
    expect(hit.line).toBe(2);
    expect(hit.match_type).toBe("regexp");
    expect(hit.semantic_score).toBeNull();
  });

  test("supports regex patterns and ignore_case", async () => {
    await Bun.write(
      join(tempDir, CONTEXT_DIR, "case.md"),
      "Hello\nhello\nHELLO\n",
    );
    const sensitive = await searchTool.execute({ pattern: "hello" }, ctx());
    expect(sensitive.matches.length).toBe(1);
    const insensitive = await searchTool.execute(
      { pattern: "hello", ignore_case: true },
      ctx(),
    );
    expect(insensitive.matches.length).toBe(3);
  });

  test("context lines surround the hit", async () => {
    await Bun.write(
      join(tempDir, CONTEXT_DIR, "ctx.md"),
      "before1\nbefore2\nMATCH\nafter1\nafter2\n",
    );
    const result = await searchTool.execute(
      { pattern: "MATCH", context: 1 },
      ctx(),
    );
    const hit = result.matches[0];
    if (!hit) throw new Error("no hit");
    expect(hit.context_lines).toEqual(["before2", "MATCH", "after1"]);
  });

  test("scope restricts walk to a sub-directory", async () => {
    await mkdir(join(tempDir, CONTEXT_DIR, "a"), { recursive: true });
    await mkdir(join(tempDir, CONTEXT_DIR, "b"), { recursive: true });
    await Bun.write(join(tempDir, CONTEXT_DIR, "a", "x.md"), "kubernetes here");
    await Bun.write(join(tempDir, CONTEXT_DIR, "b", "y.md"), "kubernetes here");
    const result = await searchTool.execute(
      { pattern: "kubernetes", scope: "a" },
      ctx(),
    );
    expect(result.is_error).toBe(false);
    expect(result.matches.length).toBe(1);
    const hit = result.matches[0];
    if (!hit) throw new Error("no hit");
    expect(hit.path.startsWith("a/")).toBe(true);
  });

  test("glob filters files by basename", async () => {
    await Bun.write(join(tempDir, CONTEXT_DIR, "keep.md"), "needle here");
    await Bun.write(join(tempDir, CONTEXT_DIR, "skip.txt"), "needle here");
    const result = await searchTool.execute(
      { pattern: "needle", glob: "*.md" },
      ctx(),
    );
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.path).toBe("keep.md");
  });

  test("traversal scope is rejected by the sandbox", async () => {
    await expect(
      searchTool.execute({ pattern: ".", scope: "../escape" }, ctx()),
    ).rejects.toThrow(/escapes project root/);
  });

  test("throws on a malformed regex pattern", async () => {
    // Unlike search_threads (which returns a structured invalid_regex
    // error), the `search` tool bubbles the SyntaxError up — the caller's
    // tool-loop wrapper turns it into a tool_result error.
    await expect(
      searchTool.execute({ pattern: "(unclosed", max_results: 5 }, ctx()),
    ).rejects.toThrow(/regular expression|missing/i);
  });

  test("max_results caps fused result count", async () => {
    for (let i = 0; i < 5; i++) {
      await Bun.write(
        join(tempDir, CONTEXT_DIR, `file${i}.md`),
        "needle\n".repeat(3),
      );
    }
    const result = await searchTool.execute(
      { pattern: "needle", max_results: 4 },
      ctx(),
    );
    expect(result.matches.length).toBeLessThanOrEqual(4);
  });
});
