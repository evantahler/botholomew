import { extractTableBlocks, renderTable } from "./markdownTables.ts";

/**
 * Render markdown to ANSI for a TUI detail pane. When `width` is provided,
 * GFM tables are pulled out and rendered ourselves at that width before
 * handing the rest off to `Bun.markdown.ansi` — Bun's renderer ignores any
 * width hint and emits tables at their natural width, which `wrap-ansi` then
 * shreds mid-cell.
 */
export function renderMarkdown(text: string, width?: number): string {
  if (!text) return "";
  if (width === undefined || width <= 0) {
    return Bun.markdown.ansi(text).trimEnd();
  }

  const blocks = extractTableBlocks(text);
  if (blocks.length === 0) {
    return Bun.markdown.ansi(text).trimEnd();
  }

  const lines = text.split("\n");
  const rendered: string[] = blocks.map((b) =>
    renderTable(b.rows, b.aligns, width),
  );
  // Bun.markdown.ansi mangles NUL bytes (→ U+FFFD), so use a plain alphanumeric
  // sentinel that survives the markdown pass intact. Wrap each block's
  // line-range with a single sentinel line, then splice the pre-rendered
  // table back in after Bun finishes styling the rest of the document.
  const sentinel = (i: number) => `BHTBLSENTINEL${i}BHTBLEND`;
  const out = lines.slice();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b) continue;
    out.splice(b.start, b.end - b.start + 1, sentinel(i));
  }
  const piped = Bun.markdown.ansi(out.join("\n")).trimEnd();
  let stitched = piped;
  for (let i = 0; i < blocks.length; i++) {
    // Bun wraps each paragraph with a trailing reset (`\x1b[0m`). Strip any
    // SGR escapes that hug the sentinel so the table doesn't inherit them.
    const re = new RegExp(
      `(?:\\x1b\\[[0-9;]*m)*${sentinel(i)}(?:\\x1b\\[[0-9;]*m)*`,
    );
    stitched = stitched.replace(re, rendered[i] ?? "");
  }
  return stitched;
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}
