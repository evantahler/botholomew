/**
 * URL extraction for the TUI.
 *
 * Two consumers, one scanner:
 *
 * 1. `renderMarkdown` masks these spans before handing text to
 *    `Bun.markdown.ansi`, which otherwise hard-wraps at a fixed 80 columns by
 *    inserting literal newlines *inside* the URL and emits autolinks twice as
 *    `text (href)`. A 436-char OAuth URL comes out with 12 newlines baked in.
 * 2. The `^l` link picker, which lists every URL seen this session so the user
 *    can open or copy one without selecting wrapped text out of scrollback.
 */

export interface LinkSpan {
  /** Index into the source string where the replaceable span starts. */
  start: number;
  /** Index one past the end of the span. */
  end: number;
  /** The URL itself, verbatim. */
  url: string;
  /**
   * Display text for a markdown `[label](url)` span. Undefined for bare and
   * `<autolink>` forms, where the URL is its own label.
   */
  label?: string;
}

// Stop at whitespace and at delimiters that can't appear unescaped in a URL.
// `)` is allowed through so Wikipedia-style paths survive; `trimTrailing` then
// drops one only when it's unbalanced (i.e. it closed the surrounding prose).
const BARE_URL = /https?:\/\/[^\s<>"'`\\\]}]+/g;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\((\s*)(https?:\/\/[^\s)]+)\s*\)/g;
const AUTOLINK = /<(https?:\/\/[^\s>]+)>/g;

/**
 * Byte ranges of fenced code blocks. Fenced blocks are the one markdown form
 * Bun already renders verbatim, so a URL inside one is safe and rewriting it
 * would corrupt code the user asked to see.
 *
 * Inline `code` spans are deliberately *not* excluded: Bun shreds a long URL
 * inside backticks exactly as it does a bare one, so those still need masking.
 */
function fenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // Fenced blocks: ``` or ~~~ at the start of a line through the closing fence
  // (or end of text, since a streaming preview can show a half-open fence).
  const fence = /^[ \t]*(```+|~~~+)[^\n]*$/gm;
  const fences: Array<{ index: number; end: number }> = [];
  for (const m of text.matchAll(fence)) {
    fences.push({ index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < fences.length; i += 2) {
    const open = fences[i];
    if (!open) break;
    const close = fences[i + 1];
    ranges.push([open.index, close ? close.end : text.length]);
  }

  return ranges;
}

function inRanges(ranges: Array<[number, number]>, start: number): boolean {
  return ranges.some(([s, e]) => start >= s && start < e);
}

/**
 * Trailing characters that read as sentence punctuation far more often than as
 * part of the URL. Also drops a trailing `)` left unbalanced by the opening
 * paren of the surrounding prose.
 */
function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last && ".,;:!?".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return out;
}

/**
 * All link spans in `text`, sorted by position and guaranteed non-overlapping.
 * Markdown links and autolinks win over the bare-URL scan for the same offset.
 */
export function findLinkSpans(text: string): LinkSpan[] {
  if (!text) return [];
  const skip = fenceRanges(text);
  const spans: LinkSpan[] = [];

  for (const m of text.matchAll(MARKDOWN_LINK)) {
    if (inRanges(skip, m.index)) continue;
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      url: m[3] ?? "",
      label: m[1] ?? "",
    });
  }

  for (const m of text.matchAll(AUTOLINK)) {
    if (inRanges(skip, m.index)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, url: m[1] ?? "" });
  }

  for (const m of text.matchAll(BARE_URL)) {
    const at = m.index;
    if (inRanges(skip, at)) continue;
    // Already covered by a markdown link or autolink at this offset.
    if (spans.some((s) => at >= s.start && at < s.end)) continue;
    const url = trimTrailing(m[0]);
    if (!url) continue;
    spans.push({ start: at, end: at + url.length, url });
  }

  spans.sort((a, b) => a.start - b.start);

  // Drop any span that overlaps one already accepted (defensive; the guards
  // above should make this a no-op).
  const out: LinkSpan[] = [];
  let cursor = -1;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out.push(s);
    cursor = s.end;
  }
  return out;
}

/** Deduped, order-preserving list of URLs in `text`. */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const span of findLinkSpans(text)) {
    if (seen.has(span.url)) continue;
    seen.add(span.url);
    out.push(span.url);
  }
  return out;
}

export interface LinkEntry {
  url: string;
  /** Human label — the markdown link text, or a shortened form of the URL. */
  label: string;
  /** Where it came from, e.g. "Botholomew 14:32" or "arcade / Arcade_UseTool". */
  source: string;
}

export interface LinkSource {
  /** Text to scan. */
  text: string;
  /** Attribution shown in the picker. */
  source: string;
  /** Ordering key; higher is newer. */
  order: number;
}

/** Shorten a URL for the picker's one-line label. */
export function shortenUrl(url: string, max = 60): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const head = `${u.host}${u.pathname}`;
    if (head.length >= max) return `${head.slice(0, max - 1)}…`;
    return `${head}${u.search ? "?…" : ""}`;
  } catch {
    return `${url.slice(0, max - 1)}…`;
  }
}

/**
 * Newest-first, deduped list of links across the supplied sources. Kept pure so
 * it can be unit-tested without a renderer — the React side just memoizes it
 * over the message list and the session's tool calls.
 */
export function collectLinks(sources: LinkSource[], limit = 20): LinkEntry[] {
  const ordered = [...sources].sort((a, b) => b.order - a.order);
  const seen = new Set<string>();
  const out: LinkEntry[] = [];
  for (const src of ordered) {
    for (const span of findLinkSpans(src.text)) {
      if (seen.has(span.url)) continue;
      seen.add(span.url);
      out.push({
        url: span.url,
        label: span.label?.trim() || shortenUrl(span.url),
        source: src.source,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
