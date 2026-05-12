import { describe, expect, test } from "bun:test";
import { isMarkdownPath, renderMarkdown } from "../../src/tui/markdown.ts";

describe("isMarkdownPath", () => {
  test("matches .md path", () => {
    expect(isMarkdownPath("docs/x.md")).toBe(true);
  });

  test("is case-insensitive on extension", () => {
    expect(isMarkdownPath("docs/README.MD")).toBe(true);
  });

  test("returns false for plain text", () => {
    expect(isMarkdownPath("notes/file.txt")).toBe(false);
  });

  test("returns false for .md in the middle of a filename", () => {
    expect(isMarkdownPath("notes/readme.md.bak")).toBe(false);
  });
});

describe("renderMarkdown", () => {
  test("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  test("renders non-empty markdown to a non-empty string", () => {
    const out = renderMarkdown("# Heading\n\nhello");
    expect(out.length).toBeGreaterThan(0);
    expect(out.endsWith("\n")).toBe(false);
  });

  test("with width, narrows wide tables to the target width", () => {
    const md = `prose before\n\n| A | B | C |\n|---|---|---|\n| the quick brown fox jumps | over the lazy dog | thrice |\n\nprose after`;
    const out = renderMarkdown(md, 30);
    const ansiRe = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
    const stripped = out
      .split("\n")
      .map((l) => Array.from(l.replace(ansiRe, "")).length);
    const tableLines = stripped.filter((w) => w === 30);
    expect(tableLines.length).toBeGreaterThanOrEqual(5); // 3 borders + 2 rows
    expect(out).toContain("prose before");
    expect(out).toContain("prose after");
    expect(out).toContain("…");
  });

  test("without width, falls through to legacy renderer", () => {
    const md = `| A | B |\n|---|---|\n| 1 | 2 |`;
    const out = renderMarkdown(md);
    // Legacy path uses Bun.markdown.ansi unmodified — table is rendered at
    // natural width with no ellipsis.
    expect(out).not.toContain("…");
    expect(out).toContain("│");
  });
});
