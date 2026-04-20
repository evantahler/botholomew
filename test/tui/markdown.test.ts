import { describe, expect, test } from "bun:test";
import { isMarkdownItem, renderMarkdown } from "../../src/tui/markdown.ts";

type DetectShape = Parameters<typeof isMarkdownItem>[0];

function item(overrides: Partial<DetectShape>): DetectShape {
  return {
    mime_type: "text/plain",
    source_path: null,
    context_path: "/notes/file.txt",
    ...overrides,
  };
}

describe("isMarkdownItem", () => {
  test("matches mime_type text/markdown", () => {
    expect(isMarkdownItem(item({ mime_type: "text/markdown" }))).toBe(true);
  });

  test("matches .md source_path", () => {
    expect(isMarkdownItem(item({ source_path: "/abs/path/README.md" }))).toBe(
      true,
    );
  });

  test("matches .md context_path when source_path is null", () => {
    expect(
      isMarkdownItem(item({ source_path: null, context_path: "/docs/x.md" })),
    ).toBe(true);
  });

  test("is case-insensitive on extension", () => {
    expect(isMarkdownItem(item({ context_path: "/docs/README.MD" }))).toBe(
      true,
    );
  });

  test("returns false for plain text", () => {
    expect(isMarkdownItem(item({}))).toBe(false);
  });

  test("returns false for .txt files", () => {
    expect(
      isMarkdownItem(item({ source_path: "/a.txt", context_path: "/a.txt" })),
    ).toBe(false);
  });

  test("returns false for .md in the middle of a filename", () => {
    expect(isMarkdownItem(item({ context_path: "/notes/readme.md.bak" }))).toBe(
      false,
    );
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
