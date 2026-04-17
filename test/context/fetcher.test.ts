import { afterEach, describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../../src/config/schemas.ts";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";

let mockCreate: ReturnType<typeof mock>;

mock.module("@anthropic-ai/sdk", () => {
  mockCreate = mock(async () => ({
    content: [{ type: "text", text: "No tools available" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 10 },
  }));

  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

const { fetchUrl, httpFallback, FetchFailureError } = await import(
  "../../src/context/fetcher.ts"
);

const config: Required<BotholomewConfig> = {
  ...DEFAULT_CONFIG,
  anthropic_api_key: "test-key",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockCreate?.mockClear();
});

describe("fetchUrl", () => {
  test("throws when no anthropic_api_key", async () => {
    const noKeyConfig = { ...config, anthropic_api_key: "" };
    await expect(
      fetchUrl("https://example.com", noKeyConfig, null),
    ).rejects.toThrow("Anthropic API key is required");
  });

  test("falls back to HTTP when no mcpxClient", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          "<html><title>Example</title><body><p>Hello world</p></body></html>",
          {
            headers: { "content-type": "text/html" },
          },
        ),
    ) as unknown as typeof fetch;

    const result = await fetchUrl("https://example.com", config, null);
    expect(result.title).toBe("Example");
    expect(result.content).toContain("Hello world");
    expect(result.sourceUrl).toBe("https://example.com");
    expect(result.mimeType).toBe("text/markdown");
  });

  test("captures mcp_exec content and returns it on accept_content", async () => {
    const fakeMcpxClient = {
      exec: mock(async () => ({
        content: [{ type: "text", text: "# Hello from MCPX" }],
        isError: false,
      })),
    } as unknown as McpxClient;

    let call = 0;
    mockCreate.mockImplementation(async () => {
      call++;
      if (call === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "exec_abc",
              name: "mcp_exec",
              input: {
                server: "google-docs",
                tool: "GetDocument",
                args: { id: "abc123" },
              },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 50, output_tokens: 30 },
        };
      }
      return {
        content: [
          {
            type: "tool_use",
            id: "accept_1",
            name: "accept_content",
            input: {
              exec_call_id: "exec_abc",
              title: "Test Doc",
              mime_type: "text/markdown",
            },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 30 },
      };
    });

    const result = await fetchUrl(
      "https://docs.google.com/document/d/abc123",
      config,
      fakeMcpxClient,
    );

    expect(result.title).toBe("Test Doc");
    expect(result.content).toBe("# Hello from MCPX");
    expect(result.mimeType).toBe("text/markdown");
  });

  test("retries when accept_content references unknown exec_call_id", async () => {
    let call = 0;
    mockCreate.mockImplementation(async () => {
      call++;
      if (call === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "accept_1",
              name: "accept_content",
              input: { exec_call_id: "missing", title: "X" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 50, output_tokens: 30 },
        };
      }
      // After error, agent gives up and requests fallback
      return {
        content: [
          {
            type: "tool_use",
            id: "fb_1",
            name: "request_http_fallback",
            input: {},
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 30 },
      };
    });

    globalThis.fetch = mock(
      async () =>
        new Response("Fallback", { headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;

    const fakeMcpxClient = {} as unknown as McpxClient;
    const result = await fetchUrl(
      "https://example.com",
      config,
      fakeMcpxClient,
    );
    expect(result.content).toBe("Fallback");
    expect(call).toBe(2);
  });

  test("falls back to HTTP when agent calls request_http_fallback", async () => {
    mockCreate.mockImplementation(async () => ({
      content: [
        {
          type: "tool_use",
          id: "fb_1",
          name: "request_http_fallback",
          input: {},
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    globalThis.fetch = mock(
      async () =>
        new Response("Plain text content", {
          headers: { "content-type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    const fakeMcpxClient = {} as unknown as McpxClient;
    const result = await fetchUrl(
      "https://example.com/page.txt",
      config,
      fakeMcpxClient,
    );

    expect(result.content).toBe("Plain text content");
    expect(result.mimeType).toBe("text/plain");
  });

  test("throws FetchFailureError when agent calls report_failure", async () => {
    mockCreate.mockImplementation(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "report_failure",
          input: {
            message:
              "This Google Doc is private — share it with your service account.",
          },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    const fakeMcpxClient = {} as unknown as McpxClient;
    let caught: unknown;
    try {
      await fetchUrl(
        "https://docs.google.com/document/d/private",
        config,
        fakeMcpxClient,
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FetchFailureError);
    expect(
      (caught as InstanceType<typeof FetchFailureError>).userMessage,
    ).toContain("share it with your service account");
  });

  test("falls back to HTTP when agent returns no tool use", async () => {
    mockCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: "I cannot fetch this." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));

    globalThis.fetch = mock(
      async () =>
        new Response("Fallback content", {
          headers: { "content-type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    const fakeMcpxClient = {} as unknown as McpxClient;
    const result = await fetchUrl(
      "https://example.com",
      config,
      fakeMcpxClient,
    );

    expect(result.content).toBe("Fallback content");
  });
});

describe("httpFallback", () => {
  test("fetches HTML and strips tags", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          "<html><head><title>My Page</title></head><body><p>Content here</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    ) as unknown as typeof fetch;

    const result = await httpFallback("https://example.com");
    expect(result.title).toBe("My Page");
    expect(result.content).toContain("Content here");
    expect(result.content).not.toContain("<p>");
    expect(result.mimeType).toBe("text/markdown");
  });

  test("fetches plain text as-is", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("Just text", {
          headers: { "content-type": "text/plain" },
        }),
    ) as unknown as typeof fetch;

    const result = await httpFallback("https://example.com/file.txt");
    expect(result.content).toBe("Just text");
    expect(result.mimeType).toBe("text/plain");
  });

  test("throws on HTTP errors", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
    ) as unknown as typeof fetch;

    await expect(httpFallback("https://example.com/missing")).rejects.toThrow(
      "HTTP 404",
    );
  });

  test("uses URL as title when no <title> tag", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("<html><body>No title</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;

    const result = await httpFallback("https://example.com/page");
    expect(result.title).toBe("https://example.com/page");
  });
});
