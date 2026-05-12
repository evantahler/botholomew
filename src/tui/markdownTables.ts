/**
 * GFM table extraction + width-aware ANSI rendering.
 *
 * `Bun.markdown.ansi` renders tables at their natural width and ignores the
 * caller's column budget, so wide tables get hard-wrapped mid-cell by
 * `wrap-ansi` in the detail pane. We pre-extract table blocks, render them
 * ourselves at a width that fits, and let `Bun.markdown.ansi` handle the rest.
 */

export type Align = "left" | "center" | "right";

export interface TableBlock {
  /** First line index (inclusive) of the table in the original text. */
  start: number;
  /** Last line index (inclusive). */
  end: number;
  /** First row is the header. */
  rows: string[][];
  aligns: Align[];
}

const DIM_ON = "\x1b[2m";
const BOLD_ON = "\x1b[1m";
const RESET = "\x1b[0m";

const SEPARATOR_CELL_RE = /^\s*:?-{1,}:?\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

export function extractTableBlocks(text: string): TableBlock[] {
  const lines = text.split("\n");
  const blocks: TableBlock[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (inFence || !looksLikePipeRow(line)) {
      i++;
      continue;
    }
    const sep = lines[i + 1] ?? "";
    if (!looksLikePipeRow(sep)) {
      i++;
      continue;
    }
    const sepCells = splitRow(sep);
    if (!sepCells.every((c) => SEPARATOR_CELL_RE.test(c))) {
      i++;
      continue;
    }
    const header = splitRow(line);
    const colCount = Math.max(header.length, sepCells.length);
    const aligns: Align[] = sepCells.slice(0, colCount).map(parseAlignCell);
    while (aligns.length < colCount) aligns.push("left");

    const rows: string[][] = [normalizeRow(header, colCount)];
    let j = i + 2;
    while (j < lines.length) {
      const body = lines[j] ?? "";
      if (!looksLikePipeRow(body)) break;
      // A new separator (consecutive tables) terminates this one.
      if (splitRow(body).every((c) => SEPARATOR_CELL_RE.test(c))) break;
      rows.push(normalizeRow(splitRow(body), colCount));
      j++;
    }

    blocks.push({ start: i, end: j - 1, rows, aligns });
    i = j;
  }
  return blocks;
}

export function renderTable(
  rows: string[][],
  aligns: Align[],
  width: number,
): string {
  if (rows.length === 0) return "";
  const colCount = rows[0]?.length ?? 0;
  if (colCount === 0) return "";

  const plain = rows.map((r) => r.map(stripInlineMarkdown));

  // Per-column natural width (max visible width across all cells).
  const naturalWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let w = 1;
    for (const row of plain) {
      const cell = row[c] ?? "";
      if (visibleWidth(cell) > w) w = visibleWidth(cell);
    }
    naturalWidths.push(w);
  }

  // Overhead: leading "│ " + trailing " │" + " │ " between cols.
  const borderOverhead = colCount * 3 + 1;
  const naturalTotal =
    naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;

  let colWidths: number[];
  if (naturalTotal <= width || width <= 0) {
    colWidths = naturalWidths;
  } else {
    colWidths = shrinkColumns(naturalWidths, width - borderOverhead);
  }

  const lines: string[] = [];
  lines.push(borderLine("┌", "┬", "┐", colWidths));
  for (let r = 0; r < plain.length; r++) {
    const cells = plain[r] ?? [];
    const isHeader = r === 0;
    lines.push(dataLine(cells, aligns, colWidths, isHeader));
    if (isHeader) {
      lines.push(borderLine("├", "┼", "┤", colWidths));
    }
  }
  lines.push(borderLine("└", "┴", "┘", colWidths));
  return lines.join("\n");
}

function looksLikePipeRow(line: string): boolean {
  // A GFM table row contains at least one unescaped pipe and (after trimming
  // surrounding whitespace + optional pipes) is non-empty.
  const stripped = line.trim();
  if (stripped === "") return false;
  if (!stripped.includes("|")) return false;
  return true;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      buf += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

function parseAlignCell(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function normalizeRow(cells: string[], colCount: number): string[] {
  const out = cells.slice(0, colCount);
  while (out.length < colCount) out.push("");
  return out;
}

function shrinkColumns(natural: number[], budget: number): number[] {
  const MIN = 3;
  const n = natural.length;
  if (budget < n * MIN) {
    // Not enough room even for ellipsis everywhere — give each column MIN
    // and let the caller deal with overflow. (Detail pane minimum is much
    // wider than this in practice.)
    return new Array(n).fill(MIN);
  }
  const total = natural.reduce((a, b) => a + b, 0) || 1;
  const raw = natural.map((w) => (w * budget) / total);
  const floored = raw.map((v) => Math.max(MIN, Math.floor(v)));
  let used = floored.reduce((a, b) => a + b, 0);
  // Distribute the remainder to columns with the largest fractional part.
  const remainders = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (used < budget && k < remainders.length * 4) {
    const idx = remainders[k % remainders.length]?.i ?? 0;
    floored[idx] = (floored[idx] ?? MIN) + 1;
    used++;
    k++;
  }
  // If we overshot due to MIN clamping, trim from the widest column(s).
  while (used > budget) {
    let widest = 0;
    for (let i = 1; i < n; i++) {
      if ((floored[i] ?? 0) > (floored[widest] ?? 0)) widest = i;
    }
    if ((floored[widest] ?? 0) <= MIN) break;
    floored[widest] = (floored[widest] ?? 0) - 1;
    used--;
  }
  return floored;
}

function borderLine(
  left: string,
  mid: string,
  right: string,
  widths: number[],
): string {
  const segs = widths.map((w) => "─".repeat(w + 2));
  return DIM_ON + left + segs.join(mid) + right + RESET;
}

function dataLine(
  cells: string[],
  aligns: Align[],
  widths: number[],
  bold: boolean,
): string {
  const parts: string[] = [];
  parts.push(`${DIM_ON}│${RESET}`);
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] ?? 0;
    const align = aligns[i] ?? "left";
    const raw = cells[i] ?? "";
    const fitted = padCell(raw, w, align);
    const styled = bold ? `${BOLD_ON}${fitted}${RESET}` : fitted;
    parts.push(` ${styled} `);
    parts.push(`${DIM_ON}│${RESET}`);
  }
  return parts.join("");
}

function padCell(text: string, width: number, align: Align): string {
  const truncated = truncateToWidth(text, width);
  const pad = width - visibleWidth(truncated);
  if (pad <= 0) return truncated;
  if (align === "right") return " ".repeat(pad) + truncated;
  if (align === "center") {
    const l = Math.floor(pad / 2);
    const r = pad - l;
    return " ".repeat(l) + truncated + " ".repeat(r);
  }
  return truncated + " ".repeat(pad);
}

function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  if (width === 1) return "…";
  const chars = Array.from(text);
  let out = "";
  let used = 0;
  for (const ch of chars) {
    if (used + 1 > width - 1) break;
    out += ch;
    used++;
  }
  return `${out}…`;
}

function visibleWidth(text: string): number {
  // Cell text has no ANSI (we strip markdown markers before measuring), so
  // codepoint count is sufficient. East-Asian double-width chars would be
  // undercounted; out of scope for v1.
  return Array.from(text).length;
}

function stripInlineMarkdown(text: string): string {
  // Strip a small set of inline markers so cell width measurement matches what
  // the user sees. Order matters: longer markers first.
  let s = text;
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1$2");
  // Collapse \| escapes that survived splitRow.
  s = s.replace(/\\\|/g, "|");
  return s;
}
