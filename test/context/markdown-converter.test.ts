/**
 * convertToMarkdown is a single-shot LLM call that turns arbitrary content
 * (HTML, JSON, XML, etc.) into Markdown before storage. We exercise:
 * the markdown short-circuit, the conversion happy-path, the empty-output
 * fallback, the max_tokens hard failure, and the transient-error fallback.
 */

import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

type FinalMessage = {
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string;
};

type StreamFactory = (
  args: unknown,
) => StreamMock | { error: Error } | (() => never);

interface StreamMock {
  [Symbol.asyncIterator](): AsyncIterator<{
    type: string;
    delta?: { type: string; text: string };
  }>;
  finalMessage(): Promise<FinalMessage>;
}

function makeStream(final: FinalMessage): StreamMock {
  const text = final.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // One synthetic text_delta per chunk so streaming progress logs fire.
  const CHUNK = 500;
  async function* iter() {
    for (let i = 0; i < text.length; i += CHUNK) {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: text.slice(i, i + CHUNK) },
      };
    }
  }
  return {
    [Symbol.asyncIterator]: iter,
    finalMessage: async () => final,
  };
}

let nextStream: StreamFactory = () =>
  makeStream({ content: [], stop_reason: "end_turn" });

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      stream: (args: unknown) => {
        const result = nextStream(args);
        if (typeof result === "function") return result();
        return result;
      },
    };
  },
}));

const {
  convertToMarkdown,
  isMarkdownMimeType,
  sniffNonMarkdownMimeType,
  resolveEffectiveMimeType,
} = await import("../../src/context/markdown-converter.ts");
const { FetchFailureError } = await import(
  "../../src/context/fetcher-errors.ts"
);

const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
} as Required<typeof DEFAULT_CONFIG>;

describe("isMarkdownMimeType", () => {
  test("recognizes markdown mime types", () => {
    expect(isMarkdownMimeType("text/markdown")).toBe(true);
    expect(isMarkdownMimeType("text/x-markdown")).toBe(true);
    expect(isMarkdownMimeType("text/md")).toBe(true);
    expect(isMarkdownMimeType("text/markdown; charset=utf-8")).toBe(true);
  });

  test("rejects non-markdown mime types", () => {
    expect(isMarkdownMimeType("text/html")).toBe(false);
    expect(isMarkdownMimeType("application/json")).toBe(false);
    expect(isMarkdownMimeType("text/plain")).toBe(false);
    expect(isMarkdownMimeType("")).toBe(false);
  });
});

describe("sniffNonMarkdownMimeType", () => {
  test("detects HTML doctype", () => {
    expect(
      sniffNonMarkdownMimeType("<!DOCTYPE html><html><body>x</body></html>"),
    ).toBe("text/html");
  });

  test("detects bare <html> root", () => {
    expect(sniffNonMarkdownMimeType("<html><body>x</body></html>")).toBe(
      "text/html",
    );
  });

  test("detects HTML by tag density", () => {
    const dense =
      "<div><p>a</p><p>b</p><p>c</p><span>d</span><a>e</a><b>f</b><i>g</i><em>h</em><strong>i</strong><u>j</u></div>";
    expect(sniffNonMarkdownMimeType(dense)).toBe("text/html");
  });

  test("does not flag markdown with occasional inline HTML", () => {
    const md = `# Heading\n\nSome paragraph with a <br> and <kbd>Ctrl</kbd> and that's about it.\n\n- list item\n- list item\n\n## Another heading\n\nMore prose. ${"word ".repeat(50)}`;
    expect(sniffNonMarkdownMimeType(md)).toBeNull();
  });

  test("detects XML", () => {
    expect(sniffNonMarkdownMimeType('<?xml version="1.0"?><root/>')).toBe(
      "application/xml",
    );
  });

  test("detects JSON object", () => {
    expect(sniffNonMarkdownMimeType('{"a":1,"b":[2,3]}')).toBe(
      "application/json",
    );
  });

  test("detects JSON array", () => {
    expect(sniffNonMarkdownMimeType("[1,2,3]")).toBe("application/json");
  });

  test("does not flag markdown that happens to start with a brace", () => {
    expect(sniffNonMarkdownMimeType("{ this is not json")).toBeNull();
  });

  test("returns null for plain markdown", () => {
    expect(
      sniffNonMarkdownMimeType("# Heading\n\nParagraph.\n\n- a\n- b"),
    ).toBeNull();
  });

  test("returns null for empty content", () => {
    expect(sniffNonMarkdownMimeType("")).toBeNull();
    expect(sniffNonMarkdownMimeType("   \n\n  ")).toBeNull();
  });
});

describe("resolveEffectiveMimeType", () => {
  test("trusts a non-markdown claim without sniffing", () => {
    const r = resolveEffectiveMimeType("text/html", "# Markdown body");
    expect(r.mimeType).toBe("text/html");
    expect(r.sniffed).toBe(false);
  });

  test("verifies a markdown claim and overrides on contradiction", () => {
    const r = resolveEffectiveMimeType(
      "text/markdown",
      "<!DOCTYPE html><html><body><p>x</p></body></html>",
    );
    expect(r.mimeType).toBe("text/html");
    expect(r.sniffed).toBe(true);
  });

  test("trusts a markdown claim when content has no contradicting signal", () => {
    const r = resolveEffectiveMimeType(
      "text/markdown",
      "# Heading\n\nSome paragraph.",
    );
    expect(r.mimeType).toBe("text/markdown");
    expect(r.sniffed).toBe(false);
  });
});

describe("convertToMarkdown", () => {
  test("calls the LLM even when claimed mime type is markdown — tools mislabel format", async () => {
    // E.g. Google Docs' "Docmd" tool claims text/markdown but returns a
    // proprietary `[H1 ...]` annotation format. We can't trust the claim.
    let called = false;
    nextStream = () => {
      called = true;
      return makeStream({
        content: [{ type: "text", text: "# Cleaned up" }],
        stop_reason: "end_turn",
      });
    };
    const out = await convertToMarkdown(
      "[H1 0-10 HEADING_1] Title text",
      "text/markdown",
      "https://example.com",
      TEST_CONFIG,
    );
    expect(out).toBe("# Cleaned up");
    expect(called).toBe(true);
  });

  test("short-circuits when no API key configured", async () => {
    let called = false;
    nextStream = () => {
      called = true;
      return makeStream({ content: [], stop_reason: "end_turn" });
    };
    const out = await convertToMarkdown(
      "<p>html</p>",
      "text/html",
      "https://example.com",
      { ...TEST_CONFIG, anthropic_api_key: "" },
    );
    expect(out).toBe("<p>html</p>");
    expect(called).toBe(false);
  });

  test("converts non-markdown content via the LLM", async () => {
    nextStream = () =>
      makeStream({
        content: [{ type: "text", text: "# Heading\n\nBody text" }],
        stop_reason: "end_turn",
      });
    const out = await convertToMarkdown(
      "<h1>Heading</h1><p>Body text</p>",
      "text/html",
      "https://example.com",
      TEST_CONFIG,
    );
    expect(out).toBe("# Heading\n\nBody text");
  });

  test("strips a defensive ```markdown fence the model adds", async () => {
    nextStream = () =>
      makeStream({
        content: [
          { type: "text", text: "```markdown\n# Heading\n\nBody\n```" },
        ],
        stop_reason: "end_turn",
      });
    const out = await convertToMarkdown(
      "<h1>Heading</h1>",
      "text/html",
      "https://example.com",
      TEST_CONFIG,
    );
    expect(out).toBe("# Heading\n\nBody");
  });

  test("falls back to raw content when the model returns empty output", async () => {
    nextStream = () =>
      makeStream({
        content: [],
        stop_reason: "end_turn",
      });
    const raw = "<p>raw html</p>";
    const out = await convertToMarkdown(
      raw,
      "text/html",
      "https://example.com",
      TEST_CONFIG,
    );
    expect(out).toBe(raw);
  });

  test("throws FetchFailureError on max_tokens — never silently truncates", async () => {
    nextStream = () =>
      makeStream({
        content: [{ type: "text", text: "# partial output" }],
        stop_reason: "max_tokens",
      });
    await expect(
      convertToMarkdown(
        "huge document",
        "text/html",
        "https://example.com",
        TEST_CONFIG,
      ),
    ).rejects.toBeInstanceOf(FetchFailureError);
  });

  test("falls back to raw content on transient API errors (does not throw)", async () => {
    nextStream = () => {
      throw new Error("network blew up");
    };
    const raw = '{"data": "value"}';
    const out = await convertToMarkdown(
      raw,
      "application/json",
      "https://example.com",
      TEST_CONFIG,
    );
    expect(out).toBe(raw);
  });
});
