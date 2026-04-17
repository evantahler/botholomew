import { describe, expect, test } from "bun:test";
import {
  isUrl,
  stripHtmlTags,
  urlToContextPath,
} from "../../src/context/url-utils.ts";

describe("isUrl", () => {
  test("returns true for http URLs", () => {
    expect(isUrl("http://example.com")).toBe(true);
  });

  test("returns true for https URLs", () => {
    expect(isUrl("https://example.com/path?q=1")).toBe(true);
  });

  test("returns false for ftp URLs", () => {
    expect(isUrl("ftp://files.example.com")).toBe(false);
  });

  test("returns false for file URLs", () => {
    expect(isUrl("file:///home/user/doc.txt")).toBe(false);
  });

  test("returns false for relative paths", () => {
    expect(isUrl("./local/file.txt")).toBe(false);
    expect(isUrl("/absolute/path.txt")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isUrl("")).toBe(false);
  });

  test("returns false for plain text", () => {
    expect(isUrl("just some words")).toBe(false);
  });
});

describe("urlToContextPath", () => {
  test("derives path from a simple URL", () => {
    const result = urlToContextPath("https://example.com/page", "/");
    expect(result).toBe("/example.com/page.md");
  });

  test("derives path with prefix", () => {
    const result = urlToContextPath("https://example.com/page", "/articles");
    expect(result).toBe("/articles/example.com/page.md");
  });

  test("slugifies special characters in path", () => {
    const result = urlToContextPath(
      "https://docs.google.com/document/d/abc123/edit",
      "/",
    );
    expect(result).toBe("/docs.google.com/document-d-abc123-edit.md");
  });

  test("handles URL with no path", () => {
    const result = urlToContextPath("https://example.com", "/");
    expect(result).toBe("/example.com.md");
  });

  test("handles URL with trailing slash", () => {
    const result = urlToContextPath("https://example.com/page/", "/");
    expect(result).toBe("/example.com/page.md");
  });

  test("truncates long URLs to 120 characters", () => {
    const longPath = "a".repeat(200);
    const result = urlToContextPath(`https://example.com/${longPath}`, "/");
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result).toEndWith(".md");
  });

  test("strips trailing slash from prefix", () => {
    const result = urlToContextPath("https://example.com/page", "/docs/");
    expect(result).toBe("/docs/example.com/page.md");
  });
});

describe("stripHtmlTags", () => {
  test("removes basic HTML tags", () => {
    expect(stripHtmlTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  test("removes script blocks entirely", () => {
    const html = "<p>Before</p><script>alert('xss')</script><p>After</p>";
    expect(stripHtmlTags(html)).toBe("BeforeAfter");
  });

  test("removes style blocks entirely", () => {
    const html = "<p>Before</p><style>.red { color: red; }</style><p>After</p>";
    expect(stripHtmlTags(html)).toBe("BeforeAfter");
  });

  test("handles nested tags", () => {
    expect(stripHtmlTags("<div><span><a href='#'>Link</a></span></div>")).toBe(
      "Link",
    );
  });

  test("collapses whitespace", () => {
    expect(stripHtmlTags("<p>Hello</p>   <p>World</p>")).toBe("Hello World");
  });

  test("preserves text content", () => {
    expect(stripHtmlTags("No tags here")).toBe("No tags here");
  });

  test("handles empty input", () => {
    expect(stripHtmlTags("")).toBe("");
  });

  test("handles HTML entities (preserved as-is)", () => {
    expect(stripHtmlTags("<p>&amp; &lt; &gt;</p>")).toBe("&amp; &lt; &gt;");
  });
});
