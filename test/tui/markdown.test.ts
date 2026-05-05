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
});
