import Anthropic from "@anthropic-ai/sdk";
import type { BotholomewConfig } from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";
import { FetchFailureError } from "./fetcher-errors.ts";

const CONVERTER_MAX_TOKENS = 16_384;

const CONVERTER_SYSTEM_PROMPT = `You normalize documents to clean, well-structured Markdown.

**If the input is already clean, valid Markdown, return it verbatim with no edits.** Look for ATX headings (#, ##), bullet/numbered lists, fenced code blocks, inline code, links in [text](url) form, blockquotes, GFM tables. If the structure is consistently markdown-shaped, echo it back unchanged.

Otherwise, convert it. The input mime_type is a hint, not a guarantee — verify the actual content. Common non-markdown formats to recognize and convert:
- **HTML** — strip tags, scripts, styles, navigation/footer chrome; preserve headings, paragraphs, lists, tables, links, code.
- **JSON / XML / YAML** — render the structure as readable Markdown (headings/lists for objects, tables where appropriate, fenced code blocks for inline values).
- **DocMD (Google Docs structured format)** — lines like \`[H1 1-31 HEADING_1 tabId=t.0 ...] Title text\` or \`[P5 884-937 PARAGRAPH ...] Body text\`. Strip the bracket annotations entirely; map H1→#, H2→##, H3→###, P→paragraph; preserve the trailing text content.
- **RTF, plain text with mixed structure, ad-hoc formats** — extract the semantic content, drop the noise.

Rules for the output:
- Preserve all semantic content: headings, paragraphs, lists, tables, links, inline code, code blocks, blockquotes.
- Use ATX headings (#, ##, ###), fenced code blocks (\`\`\`lang), GFM-style tables, and reference- or inline-style links — whichever is cleanest.
- Strip metadata headers/IDs that aren't part of the document body (e.g. \`@document_id: ...\`, \`@revision_id: ...\`).
- Output **only** the Markdown. No preamble ("Here is the converted markdown:"), no trailing commentary, no wrapping the entire output in a code fence.`;

const MARKDOWN_MIME_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "text/md",
]);

export function isMarkdownMimeType(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MARKDOWN_MIME_TYPES.has(base);
}

/**
 * Sniff content for a non-markdown structure. Returns a mime type when the
 * content has unmistakable markers of HTML / XML / JSON / etc., otherwise
 * null. Used to verify a tool's claim of `text/markdown` — if the agent (or
 * a defaulted mime type) lies about the format, we want to convert anyway.
 *
 * Markdown is a superset of plain text, so a null return ≠ "definitely
 * markdown". It just means we found no strong contradicting signal.
 */
export function sniffNonMarkdownMimeType(content: string): string | null {
  const head = content.trimStart().slice(0, 4096);
  if (!head) return null;

  if (/^<!doctype\s+html/i.test(head)) return "text/html";
  if (/^<html[\s>]/i.test(head)) return "text/html";
  if (/^<\?xml[\s?]/i.test(head)) return "application/xml";

  // JSON: parses as JSON top-to-bottom (use the full content, not the head).
  const trimmed = content.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "application/json";
    } catch {
      // fall through
    }
  }

  // Heuristic HTML: dense tag markup. Markdown can contain occasional inline
  // HTML, so we only flag it when tags dominate the sample.
  const tagMatches = head.match(/<\/?[a-z][a-z0-9]*[\s/>]/gi) ?? [];
  if (tagMatches.length >= 10) {
    const charsPerTag = head.length / tagMatches.length;
    if (charsPerTag < 80) return "text/html";
  }

  return null;
}

/**
 * Decide the effective mime type for a piece of content. If the claim is
 * markdown but the content sniffs as something else, trust the sniff so we
 * convert instead of saving mislabeled garbage.
 */
export function resolveEffectiveMimeType(
  claimedMimeType: string,
  content: string,
): { mimeType: string; sniffed: boolean } {
  if (!isMarkdownMimeType(claimedMimeType)) {
    return { mimeType: claimedMimeType, sniffed: false };
  }
  const sniffed = sniffNonMarkdownMimeType(content);
  if (sniffed) return { mimeType: sniffed, sniffed: true };
  return { mimeType: claimedMimeType, sniffed: false };
}

function stripLeadingMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(
    /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/,
  );
  if (fenceMatch?.[1]) return fenceMatch[1];
  return text;
}

/**
 * Convert arbitrary content to Markdown via a single-shot LLM call.
 *
 * Does **not** short-circuit on `mimeType === "text/markdown"` — tools
 * frequently mislabel their output (e.g. Google Docs' "DocMD" tool returns
 * structured `[H1 ...]` annotations, not real markdown). The mime type is
 * passed in as a hint for the model; the model decides whether the content
 * is already markdown (echo unchanged) or needs converting.
 *
 * - Throws FetchFailureError when the response hits max_tokens (silently
 *   truncating the saved file would be worse than failing loudly).
 * - On transient API errors, logs a warning and returns the raw content so
 *   the import still produces *something* the user can edit.
 */
export async function convertToMarkdown(
  content: string,
  mimeType: string,
  sourceUrl: string,
  config: Required<BotholomewConfig>,
): Promise<string> {
  if (!config.anthropic_api_key) return content;

  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: CONVERTER_MAX_TOKENS,
      system: CONVERTER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Convert this ${mimeType} content to Markdown. Source URL: ${sourceUrl}\n\n${content}`,
        },
      ],
    });

    if (response.stop_reason === "max_tokens") {
      throw new FetchFailureError(
        `Markdown conversion exceeded token budget (max_tokens=${CONVERTER_MAX_TOKENS}). The source document is too large to convert in one pass — try fetching a smaller section or a tool that supports pagination.`,
      );
    }

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");

    if (!text.trim()) {
      logger.warn(
        "markdown conversion returned empty output — saving raw content",
      );
      return content;
    }

    return stripLeadingMarkdownFence(text);
  } catch (err) {
    if (err instanceof FetchFailureError) throw err;
    logger.warn(
      `markdown conversion failed (${err instanceof Error ? err.message : String(err)}) — saving raw content`,
    );
    return content;
  }
}
