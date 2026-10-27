import { describe, expect, test } from "bun:test";
import {
  extractTableBlocks,
  renderTable,
} from "../../src/tui/markdownTables.ts";

// Strip ANSI SGR escapes for visible-width assertions. Constructed via
// RegExp + char code so neither the regex source nor the test file contains
// a literal control byte (which biome rejects in regex literals).
const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const ESC = String.fromCharCode(0x1b);

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

describe("extractTableBlocks", () => {
  test("parses a simple table", () => {
    const md = `before\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nafter`;
    const blocks = extractTableBlocks(md);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    if (!b) throw new Error("expected a table block");
    expect(b.rows).toEqual([
      ["A", "B", "C"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(b.aligns).toEqual(["left", "left", "left"]);
    expect(b.start).toBe(2);
    expect(b.end).toBe(5);
  });

  test("parses alignment markers", () => {
    const md = `| A | B | C |\n|:--|:-:|--:|\n| a | b | c |`;
    const blocks = extractTableBlocks(md);
    expect(blocks[0]?.aligns).toEqual(["left", "center", "right"]);
  });

  test("ignores pipe rows inside fenced code blocks", () => {
    const md = "```\n| not | a | table |\n|---|---|---|\n| 1 | 2 | 3 |\n```\n";
    expect(extractTableBlocks(md)).toEqual([]);
  });

  test("ignores a pipe row with no separator", () => {
    const md = "| just one row |\n\nsome prose\n";
    expect(extractTableBlocks(md)).toEqual([]);
  });

  test("handles tables without surrounding pipes", () => {
    const md = `A | B\n---|---\n1 | 2`;
    const blocks = extractTableBlocks(md);
    expect(blocks[0]?.rows).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  test("respects escaped pipes inside cells", () => {
    const md = `| A | B |\n|---|---|\n| has \\| pipe | ok |`;
    const blocks = extractTableBlocks(md);
    expect(blocks[0]?.rows[1]).toEqual(["has | pipe", "ok"]);
  });

  test("pads short rows to header column count", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 1 | 2 |`;
    expect(extractTableBlocks(md)[0]?.rows[1]).toEqual(["1", "2", ""]);
  });
});

describe("renderTable", () => {
  test("renders at natural width when it fits", () => {
    const out = renderTable(
      [
        ["A", "B"],
        ["1", "22"],
      ],
      ["left", "left"],
      80,
    );
    const lines = out.split("\n");
    const widths = lines.map((l) => Array.from(stripAnsi(l)).length);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeLessThanOrEqual(80);
    expect(lines[0]?.startsWith(`${ESC}[2m`)).toBe(true);
  });

  test("bolds the header row", () => {
    const out = renderTable([["Head", "x"]], ["left", "left"], 40);
    const headerRow = out.split("\n")[1] ?? "";
    expect(headerRow).toContain(`${ESC}[1m`);
  });

  test("shrinks columns and truncates with ellipsis at narrow widths", () => {
    const out = renderTable(
      [
        ["Col1", "Col2", "Col3"],
        ["the quick brown fox", "lazy dog jumps", "etc etc etc"],
      ],
      ["left", "left", "left"],
      30,
    );
    const lines = out.split("\n");
    const widths = lines.map((l) => Array.from(stripAnsi(l)).length);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(30);
    expect(stripAnsi(out)).toContain("…");
  });

  test("strips inline markdown markers from cells", () => {
    const out = renderTable(
      [
        ["A", "B"],
        ["**bold**", "`code`"],
      ],
      ["left", "left"],
      40,
    );
    const text = stripAnsi(out);
    expect(text).toContain("bold");
    expect(text).toContain("code");
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
  });

  test("respects right and center alignment", () => {
    const out = renderTable(
      [
        ["L", "C", "R"],
        ["x", "y", "z"],
      ],
      ["left", "center", "right"],
      40,
    );
    const dataRow = stripAnsi(out.split("\n")[3] ?? "");
    const cells = dataRow
      .split("│")
      .slice(1, -1)
      .map((c) => c);
    expect(cells[0]?.startsWith(" x")).toBe(true); // left
    expect(cells[1]?.trim()).toBe("y"); // center: equal padding
    expect(cells[2]?.endsWith("z ")).toBe(true); // right
  });
});
