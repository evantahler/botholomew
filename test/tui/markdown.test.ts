import { describe, expect, test } from "bun:test";
import {
  isMarkdownPath,
  renderMarkdown,
  tailLines,
} from "../../src/tui/markdown.ts";

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

describe("tailLines", () => {
  test("returns the last N lines when text exceeds the limit", () => {
    const text = "a\nb\nc\nd\ne";
    expect(tailLines(text, 2)).toBe("d\ne");
  });

  test("returns the full text unchanged when line count <= limit", () => {
    const text = "a\nb\nc";
    expect(tailLines(text, 3)).toBe(text);
    expect(tailLines(text, 10)).toBe(text);
  });

  test("handles empty string", () => {
    expect(tailLines("", 5)).toBe("");
  });

  test("returns the text unchanged for non-positive limits", () => {
    const text = "a\nb\nc";
    expect(tailLines(text, 0)).toBe(text);
    expect(tailLines(text, -3)).toBe(text);
  });

  test("keeps a single-line string intact", () => {
    expect(tailLines("just one line", 2)).toBe("just one line");
  });
});

// Regression: Bun.markdown.ansi hard-wraps at a fixed 80 columns by inserting
// literal newlines *inside* a URL and emits autolinks twice as `text (href)`.
// A ~440-char OAuth URL came out with 12 newlines baked in, which made the
// authorization link unusable in the chat TUI no matter how it was presented.
describe("renderMarkdown — long URLs", () => {
  const OAUTH_URL =
    "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&client_id=1234567890-abcdefghijklmnop.apps.googleusercontent.com&include_granted_scopes=true&prompt=consent&redirect_uri=https%3A%2F%2Fcloud.arcade.dev%2Fapi%2Fv1%2Foauth%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events+openid+email&state=6f1d0c2a-9b3e-4a7c-8d21-ee55f0a1b2c3";

  // Built from strings rather than literals so the ESC byte doesn't trip
  // biome's noControlCharactersInRegex (same approach as markdown.ts).
  const ESC = String.fromCharCode(27);
  const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
  const OSC8 = new RegExp(`${ESC}\\]8;;.*?${ESC}\\\\`, "g");
  /** Strip SGR colors and OSC-8 hyperlink wrappers. */
  const plain = (s: string) => s.replace(SGR, "").replace(OSC8, "");

  const presentations: Array<[string, string]> = [
    ["bare", `Please visit ${OAUTH_URL} to authorize.`],
    ["bold-wrapped", `**${OAUTH_URL}**`],
    ["markdown link", `[Authorize Google Calendar](${OAUTH_URL})`],
    ["autolink", `<${OAUTH_URL}>`],
    ["inline code", `\`${OAUTH_URL}\``],
    ["fenced block", `\`\`\`\n${OAUTH_URL}\n\`\`\``],
    ["trailing period", `Go to ${OAUTH_URL}.`],
    ["inside a list item", `- auth: ${OAUTH_URL}`],
  ];

  for (const [name, source] of presentations) {
    test(`${name}: URL survives contiguous`, () => {
      expect(plain(renderMarkdown(source))).toContain(OAUTH_URL);
    });

    test(`${name}: URL is not duplicated`, () => {
      const hits = plain(renderMarkdown(source)).match(
        /accounts\.google\.com/g,
      );
      expect(hits).toHaveLength(1);
    });

    test(`${name}: no sentinel leaks into the output`, () => {
      expect(renderMarkdown(source)).not.toContain("BHURLSENTINEL");
    });
  }

  test("no newline is injected into the URL itself", () => {
    const out = plain(
      renderMarkdown(`Please visit ${OAUTH_URL} to authorize.`),
    );
    const line = out.split("\n").find((l) => l.includes("accounts.google.com"));
    expect(line).toContain(OAUTH_URL);
  });

  test("prose around the URL still renders", () => {
    const out = plain(
      renderMarkdown(`Please visit ${OAUTH_URL} to authorize.`),
    );
    expect(out).toContain("Please visit");
    expect(out).toContain("authorize");
  });

  test("markdown link keeps the URL visible alongside its label", () => {
    const out = plain(renderMarkdown(`[Authorize](${OAUTH_URL})`));
    expect(out).toContain("Authorize");
    expect(out).toContain(OAUTH_URL);
  });

  test("multiple URLs in one message all survive", () => {
    const out = plain(
      renderMarkdown(`first ${OAUTH_URL} and second https://example.com/b`),
    );
    expect(out).toContain(OAUTH_URL);
    expect(out).toContain("https://example.com/b");
  });

  test("URL-bearing text with a table still renders both", () => {
    const src = [
      `See ${OAUTH_URL}`,
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const out = plain(renderMarkdown(src, 60));
    expect(out).toContain(OAUTH_URL);
    expect(out).not.toContain("BHTBLSENTINEL");
  });

  test("hyperlinks are omitted when opted out", () => {
    const prev = process.env.BOTHOLOMEW_NO_HYPERLINKS;
    process.env.BOTHOLOMEW_NO_HYPERLINKS = "1";
    try {
      expect(renderMarkdown(`visit ${OAUTH_URL}`)).not.toContain(`${ESC}]8;;`);
    } finally {
      if (prev === undefined) delete process.env.BOTHOLOMEW_NO_HYPERLINKS;
      else process.env.BOTHOLOMEW_NO_HYPERLINKS = prev;
    }
  });

  test("text with no URL is unchanged in behavior", () => {
    expect(plain(renderMarkdown("**bold** and _italic_"))).toContain("bold");
  });
});
