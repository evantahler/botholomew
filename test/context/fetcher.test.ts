/**
 * fetchUrl drives an Anthropic loop with mcp_search/info/exec to retrieve
 * remote content; httpFallback is the no-MCP escape hatch using global
 * fetch. We exercise: the no-key guard, the no-MCP fallback path, and
 * the html-strip behavior of httpFallback.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        // Default: no content/tool calls, which makes fetchUrl exhaust its
        // turn budget and signal http fallback.
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    };
  },
}));

const { fetchUrl, FetchFailureError, httpFallback } = await import(
  "../../src/context/fetcher.ts"
);

const TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
} as Required<typeof DEFAULT_CONFIG>;

describe("fetchUrl", () => {
  test("throws when no anthropic_api_key is configured", async () => {
    await expect(
      fetchUrl(
        "https://example.com",
        { ...TEST_CONFIG, anthropic_api_key: "" },
        null,
        null as never,
      ),
    ).rejects.toThrow();
  });

  test("falls back to plain HTTP when no MCPX client is available", async () => {
    // Stub global fetch so we don't actually hit the network.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        "<html><head><title>From HTTP</title></head><body><p>hi</p></body></html>",
        { headers: { "content-type": "text/html" } },
      )) as unknown as typeof globalThis.fetch;
    try {
      const r = await fetchUrl(
        "https://example.com/page",
        TEST_CONFIG,
        null,
        null as never,
      );
      expect(r.title).toBe("From HTTP");
      expect(r.content).toContain("hi");
      expect(r.source).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("httpFallback", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test("strips HTML tags and labels as text/plain when no API key", async () => {
    globalThis.fetch = (async () =>
      new Response(
        "<html><head><title>Hello world</title></head><body><p>Body text</p></body></html>",
        { headers: { "content-type": "text/html" } },
      )) as unknown as typeof globalThis.fetch;

    // No config → no-API-key path: strip tags, label as text/plain (we can't
    // honestly produce markdown without an LLM call).
    const r = await httpFallback("https://example.com/x");
    expect(r.title).toBe("Hello world");
    expect(r.content).toContain("Body text");
    expect(r.content).not.toContain("<p>");
    expect(r.mimeType).toBe("text/plain");
    expect(r.source).toBeNull();
  });

  test("preserves non-html content as-is", async () => {
    globalThis.fetch = (async () =>
      new Response("plain text body", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof globalThis.fetch;

    const r = await httpFallback("https://example.com/raw");
    expect(r.content).toBe("plain text body");
    // No <title> match → title falls back to the URL.
    expect(r.title).toBe("https://example.com/raw");
    expect(r.mimeType).toBe("text/plain");
  });

  test("throws on non-OK responses", async () => {
    globalThis.fetch = (async () =>
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      })) as unknown as typeof globalThis.fetch;
    await expect(httpFallback("https://example.com/missing")).rejects.toThrow(
      /HTTP 404/,
    );
  });

  test("truncates very large bodies", async () => {
    const huge = "x".repeat(2_000_000);
    globalThis.fetch = (async () =>
      new Response(huge, {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof globalThis.fetch;

    const r = await httpFallback("https://example.com/huge");
    expect(r.content.length).toBeLessThan(huge.length);
  });
});

describe("FetchFailureError", () => {
  test("carries a userMessage", () => {
    const e = new FetchFailureError("private doc, share with service account");
    expect(e).toBeInstanceOf(Error);
    expect(e.userMessage).toBe("private doc, share with service account");
  });
});
