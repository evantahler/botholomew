import { findLinkSpans, type LinkSpan } from "./links.ts";
import { extractTableBlocks, renderTable } from "./markdownTables.ts";

// Bun.markdown.ansi mangles NUL bytes (→ U+FFFD), so both sentinels below are
// plain alphanumeric tokens that survive the markdown pass intact.
const tableSentinel = (i: number) => `BHTBLSENTINEL${i}BHTBLEND`;
const linkSentinel = (i: number) => `BHURLSENTINEL${i}BHURLEND`;

const SGR_LINK_ON = "\x1b[4m\x1b[34m";
// Underline-off + default-foreground rather than a full reset, so a link
// inside **bold** doesn't terminate the bold run early.
const SGR_LINK_OFF = "\x1b[39m\x1b[24m";

const OSC8_START = "\x1b]8;;";
const OSC8_END = "\x1b]8;;\x1b\\";
const ST = "\x1b\\";

/**
 * OSC-8 hyperlinks make the anchor text clickable in iTerm2, Ghostty, WezTerm,
 * VS Code and Windows Terminal; terminals without support ignore the sequence.
 * Skipped when output isn't a TTY (so piped/captured text stays clean) or when
 * the user opts out.
 */
export function hyperlinksEnabled(): boolean {
  if (process.env.BOTHOLOMEW_NO_HYPERLINKS) return false;
  return Boolean(process.stdout?.isTTY);
}

/** Wrap `text` in an OSC-8 hyperlink pointing at `url`. */
function hyperlink(url: string, text: string): string {
  if (!hyperlinksEnabled()) return text;
  return `${OSC8_START}${url}${ST}${text}${OSC8_END}`;
}

/**
 * Visible replacement for a link span. Bare URLs and `<autolinks>` render as
 * the URL itself; `[label](url)` keeps both, because dropping the URL would
 * hide it entirely on terminals without OSC-8 support.
 */
function renderLink(span: LinkSpan): string {
  const label = span.label?.trim();
  const visible = label ? `${label} (${span.url})` : span.url;
  return `${SGR_LINK_ON}${hyperlink(span.url, visible)}${SGR_LINK_OFF}`;
}

/**
 * Replace every URL with a short sentinel before `Bun.markdown.ansi` sees it.
 *
 * Bun's renderer hard-wraps at a fixed 80 columns — ignoring the terminal
 * width — by inserting literal newlines *into* the URL, and emits autolinks
 * twice as `text (href)`. A 436-char OAuth URL comes out with 12 newlines
 * baked in and is no longer selectable or clickable. Masking first lets Bun
 * wrap the surrounding prose normally while the URL is spliced back whole.
 */
function maskLinks(text: string): { masked: string; spans: LinkSpan[] } {
  const spans = findLinkSpans(text);
  if (spans.length === 0) return { masked: text, spans };
  let masked = "";
  let cursor = 0;
  spans.forEach((span, i) => {
    masked += text.slice(cursor, span.start) + linkSentinel(i);
    cursor = span.end;
  });
  masked += text.slice(cursor);
  return { masked, spans };
}

function unmaskLinks(rendered: string, spans: LinkSpan[]): string {
  let out = rendered;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span) continue;
    out = out.replace(linkSentinel(i), () => renderLink(span));
  }
  return out;
}

/**
 * Render markdown to ANSI for a TUI detail pane. When `width` is provided,
 * GFM tables are pulled out and rendered ourselves at that width before
 * handing the rest off to `Bun.markdown.ansi` — Bun's renderer ignores any
 * width hint and emits tables at their natural width, which `wrap-ansi` then
 * shreds mid-cell. URLs are masked the same way, for the same reason.
 */
export function renderMarkdown(text: string, width?: number): string {
  if (!text) return "";

  const blocks =
    width === undefined || width <= 0 ? [] : extractTableBlocks(text);

  // Tables are masked first so their cells keep their own (width-aware)
  // rendering and aren't also link-masked, which would throw off column math.
  let source = text;
  let tables: string[] = [];
  if (blocks.length > 0) {
    tables = blocks.map((b) => renderTable(b.rows, b.aligns, width as number));
    const lines = text.split("\n");
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (!b) continue;
      lines.splice(b.start, b.end - b.start + 1, tableSentinel(i));
    }
    source = lines.join("\n");
  }

  const { masked, spans } = maskLinks(source);
  let stitched = Bun.markdown.ansi(masked).trimEnd();

  for (let i = 0; i < tables.length; i++) {
    // Bun wraps each paragraph with a trailing reset (`\x1b[0m`). Strip any
    // SGR escapes that hug the sentinel so the table doesn't inherit them.
    const re = new RegExp(
      `(?:\\x1b\\[[0-9;]*m)*${tableSentinel(i)}(?:\\x1b\\[[0-9;]*m)*`,
    );
    stitched = stitched.replace(re, tables[i] ?? "");
  }

  return unmaskLinks(stitched, spans);
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

/**
 * Return the last `maxLines` source lines of `text` (rejoined with `\n`).
 * Used to bound the cost of rendering the in-flight streaming reply: the chat
 * view only shows the last ~viewport lines, so re-parsing the entire growing
 * buffer every frame is wasted work whose cost grows with the reply length.
 * A block (code fence, table) that opens above the window may be briefly
 * mis-styled in the live preview, but the finalized message re-renders the
 * full, correct markdown. Non-positive `maxLines` returns the text unchanged.
 */
export function tailLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return text;
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(lines.length - maxLines).join("\n");
}
