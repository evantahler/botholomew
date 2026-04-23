import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { embed, embedSingle } from "../../src/context/embedder-impl.ts";

const config = {
  ...DEFAULT_CONFIG,
  openai_api_key: "test-key",
  embedding_model: "text-embedding-3-small",
  embedding_dimension: 1536,
};

function mockFetchResponse(embeddings: number[][]) {
  return mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: embeddings.map((e, i) => ({ embedding: e, index: i })),
          usage: { total_tokens: 10 },
        }),
        { status: 200 },
      ),
    ),
  );
}

const originalFetchGlobal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetchGlobal;
});

describe("embed", () => {
  test("returns empty array for empty input", async () => {
    const vectors = await embed([], config);
    expect(vectors).toHaveLength(0);
  });

  test("throws when API key is missing", async () => {
    const noKeyConfig = { ...config, openai_api_key: "" };
    expect(embed(["hello"], noKeyConfig)).rejects.toThrow("OpenAI API key");
  });

  test("calls OpenAI API and returns vectors", async () => {
    const fakeVec = new Array(1536).fill(0.1);
    const originalFetch = globalThis.fetch;
    const mockFn = mockFetchResponse([fakeVec]);
    globalThis.fetch = mockFn as unknown as typeof fetch;

    try {
      const result = await embed(["hello world"], config);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1536);
      expect(mockFn).toHaveBeenCalledTimes(1);

      const callArgs = mockFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(callArgs[0]).toBe("https://api.openai.com/v1/embeddings");

      const body = JSON.parse(callArgs[1].body as string);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.dimensions).toBe(1536);
      expect(body.input).toEqual(["hello world"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sorts results by index", async () => {
    const vec0 = new Array(1536).fill(0.1);
    const vec1 = new Array(1536).fill(0.2);
    const originalFetch = globalThis.fetch;
    // Return out of order
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { embedding: vec1, index: 1 },
              { embedding: vec0, index: 0 },
            ],
            usage: { total_tokens: 10 },
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    try {
      const result = await embed(["a", "b"], config);
      expect(result[0]?.[0]).toBe(0.1);
      expect(result[1]?.[0]).toBe(0.2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws on API error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("rate limited", { status: 429 })),
    ) as unknown as typeof fetch;

    try {
      expect(embed(["hello"], config)).rejects.toThrow(
        "OpenAI embeddings API error (429)",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("embedSingle", () => {
  test("returns a single vector", async () => {
    const fakeVec = new Array(1536).fill(0.5);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchResponse([fakeVec]) as unknown as typeof fetch;

    try {
      const vec = await embedSingle("test", config);
      expect(vec).toHaveLength(1536);
      expect(vec[0]).toBe(0.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
