import { describe, expect, test } from "bun:test";
import {
  collectLinks,
  extractUrls,
  findLinkSpans,
  shortenUrl,
} from "../../src/tui/links.ts";

const OAUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&client_id=1234567890-abcdefghijklmnop.apps.googleusercontent.com&include_granted_scopes=true&prompt=consent&redirect_uri=https%3A%2F%2Fcloud.arcade.dev%2Fapi%2Fv1%2Foauth%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events+openid+email&state=6f1d0c2a-9b3e-4a7c-8d21-ee55f0a1b2c3";

describe("findLinkSpans", () => {
  test("finds a bare URL and reports its exact span", () => {
    const text = `visit ${OAUTH_URL} now`;
    const [span] = findLinkSpans(text);
    expect(span?.url).toBe(OAUTH_URL);
    expect(text.slice(span?.start, span?.end)).toBe(OAUTH_URL);
    expect(span?.label).toBeUndefined();
  });

  test("keeps the query string of a long percent-encoded OAuth URL", () => {
    const spans = findLinkSpans(OAUTH_URL);
    expect(spans[0]?.url).toBe(OAUTH_URL);
    expect(spans[0]?.url).toContain("%3A%2F%2F");
    expect(spans[0]?.url).toContain("+openid+email");
  });

  test("captures label and target of a markdown link", () => {
    const spans = findLinkSpans(`[Authorize](${OAUTH_URL})`);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.label).toBe("Authorize");
    expect(spans[0]?.url).toBe(OAUTH_URL);
  });

  test("handles an <autolink>", () => {
    const spans = findLinkSpans(`<https://example.com/a>`);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.url).toBe("https://example.com/a");
    expect(spans[0]?.label).toBeUndefined();
  });

  test("trims trailing sentence punctuation", () => {
    expect(findLinkSpans("go to https://example.com/a.")[0]?.url).toBe(
      "https://example.com/a",
    );
    expect(findLinkSpans("go to https://example.com/a, then")[0]?.url).toBe(
      "https://example.com/a",
    );
  });

  test("drops an unbalanced closing paren but keeps a balanced one", () => {
    expect(findLinkSpans("(see https://example.com/a)")[0]?.url).toBe(
      "https://example.com/a",
    );
    expect(
      findLinkSpans("https://en.wikipedia.org/wiki/Foo_(bar)")[0]?.url,
    ).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  test("skips URLs inside a fenced code block", () => {
    const text = ["before", "```", "curl https://example.com/a", "```"].join(
      "\n",
    );
    expect(findLinkSpans(text)).toHaveLength(0);
  });

  test("skips a fence left unclosed by a streaming preview", () => {
    expect(findLinkSpans("```\nhttps://example.com/a")).toHaveLength(0);
  });

  test("does NOT skip inline code — Bun shreds those URLs too", () => {
    const spans = findLinkSpans("run `https://example.com/a` please");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.url).toBe("https://example.com/a");
  });

  test("returns non-overlapping spans in source order", () => {
    const text = `a https://one.example b [two](https://two.example) c <https://three.example>`;
    const spans = findLinkSpans(text);
    expect(spans.map((s) => s.url)).toEqual([
      "https://one.example",
      "https://two.example",
      "https://three.example",
    ]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.start ?? 0).toBeGreaterThanOrEqual(
        spans[i - 1]?.end ?? 0,
      );
    }
  });

  test("does not double-count the URL inside a markdown link", () => {
    expect(findLinkSpans(`[x](https://example.com/a)`)).toHaveLength(1);
  });

  test("ignores non-http schemes", () => {
    expect(findLinkSpans("mailto:a@b.com ftp://x.example")).toHaveLength(0);
  });

  test("empty input", () => {
    expect(findLinkSpans("")).toEqual([]);
  });
});

describe("extractUrls", () => {
  test("dedupes while preserving order", () => {
    const text = "https://b.example https://a.example https://b.example";
    expect(extractUrls(text)).toEqual([
      "https://b.example",
      "https://a.example",
    ]);
  });
});

describe("shortenUrl", () => {
  test("leaves a short URL alone", () => {
    expect(shortenUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  test("collapses a long query string", () => {
    const short = shortenUrl(OAUTH_URL);
    expect(short.length).toBeLessThanOrEqual(60);
    expect(short).toContain("accounts.google.com");
  });

  test("falls back to a slice for an unparseable URL", () => {
    const short = shortenUrl(`https://${"x".repeat(200)}`, 20);
    expect(short.length).toBeLessThanOrEqual(20);
  });
});

describe("collectLinks", () => {
  const src = (text: string, source: string, order: number) => ({
    text,
    source,
    order,
  });

  test("orders newest-first and attributes the source", () => {
    const links = collectLinks([
      src("https://old.example", "Botholomew 10:00", 0),
      src("https://new.example", "arcade / Arcade_UseTool", 5),
    ]);
    expect(links.map((l) => l.url)).toEqual([
      "https://new.example",
      "https://old.example",
    ]);
    expect(links[0]?.source).toBe("arcade / Arcade_UseTool");
  });

  test("dedupes the same URL across sources, keeping the newest", () => {
    const links = collectLinks([
      src("https://x.example", "old", 0),
      src("https://x.example", "new", 9),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.source).toBe("new");
  });

  test("uses the markdown label when present", () => {
    const links = collectLinks([src(`[Authorize](${OAUTH_URL})`, "s", 0)]);
    expect(links[0]?.label).toBe("Authorize");
    expect(links[0]?.url).toBe(OAUTH_URL);
  });

  test("shortens the label for a bare long URL but keeps the URL whole", () => {
    const links = collectLinks([src(OAUTH_URL, "s", 0)]);
    expect(links[0]?.label.length).toBeLessThan(OAUTH_URL.length);
    expect(links[0]?.url).toBe(OAUTH_URL);
  });

  test("respects the limit", () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`https://e${i}.example`, "s", i),
    );
    expect(collectLinks(sources, 3)).toHaveLength(3);
  });

  test("no sources", () => {
    expect(collectLinks([])).toEqual([]);
  });
});
