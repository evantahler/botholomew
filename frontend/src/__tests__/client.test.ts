import { afterEach, describe, expect, mock, test } from "bun:test";
import { apiFetch, apiReferenceUrl } from "../utils/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Replace the global `fetch` with a stub returning the given JSON body and
 * status, capturing what `apiFetch` passed it.
 * @param body - The JSON body the stub should respond with.
 * @param status - The HTTP status the stub should respond with.
 * @returns Accessors for the URL and `RequestInit` the stub received.
 */
function stubFetch(
  body: unknown,
  status = 200,
): { capturedUrl: () => string; capturedInit: () => RequestInit | undefined } {
  let url = "";
  let init: RequestInit | undefined;
  globalThis.fetch = mock(
    async (input: RequestInfo | URL, opts?: RequestInit) => {
      url = String(input);
      init = opts;
      return new Response(JSON.stringify(body), { status });
    },
  ) as unknown as typeof fetch;
  return { capturedUrl: () => url, capturedInit: () => init };
}

describe("apiFetch", () => {
  test("prefixes the /api route and parses the JSON body", async () => {
    const cap = stubFetch({ healthy: true });
    const res = await apiFetch<{ healthy: boolean }>("/status");
    expect(res.healthy).toBe(true);
    expect(cap.capturedUrl()).toContain("/api/status");
  });

  test("sends credentials and a JSON content-type for string bodies", async () => {
    const cap = stubFetch({});
    await apiFetch("/tag", { method: "PUT", body: JSON.stringify({ a: 1 }) });
    const init = cap.capturedInit();
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  test("throws on an error envelope even when the status is 200", async () => {
    stubFetch({ error: { message: "kaboom" } }, 200);
    await expect(apiFetch("/broken")).rejects.toThrow("kaboom");
  });
});

describe("apiReferenceUrl", () => {
  test("points at the backend's OpenAPI document", () => {
    expect(apiReferenceUrl("https://api.botholomew.com")).toBe(
      "https://api.botholomew.com/api/swagger",
    );
  });

  test("gives the same answer for a base written with a trailing slash", () => {
    expect(apiReferenceUrl("http://localhost:8080/")).toBe(
      apiReferenceUrl("http://localhost:8080"),
    );
  });
});
