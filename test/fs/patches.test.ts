import { describe, expect, test } from "bun:test";
import { applyLinePatches, LinePatchSchema } from "../../src/fs/patches.ts";

describe("applyLinePatches", () => {
  test("replaces a single line", () => {
    const raw = "a\nb\nc\n";
    const out = applyLinePatches(raw, [
      { start_line: 2, end_line: 2, content: "B" },
    ]);
    expect(out).toBe("a\nB\nc\n");
  });

  test("inserts without replacing when end_line === 0", () => {
    const raw = "a\nb\nc\n";
    const out = applyLinePatches(raw, [
      { start_line: 2, end_line: 0, content: "X" },
    ]);
    expect(out).toBe("a\nX\nb\nc\n");
  });

  test("deletes a line range when content is empty", () => {
    const raw = "a\nb\nc\nd\n";
    const out = applyLinePatches(raw, [
      { start_line: 2, end_line: 3, content: "" },
    ]);
    expect(out).toBe("a\nd\n");
  });

  test("applies multiple patches bottom-up so earlier line numbers stay stable", () => {
    const raw = "1\n2\n3\n4\n5\n";
    const out = applyLinePatches(raw, [
      { start_line: 1, end_line: 1, content: "ONE" },
      { start_line: 5, end_line: 5, content: "FIVE" },
    ]);
    expect(out).toBe("ONE\n2\n3\n4\nFIVE\n");
  });

  test("replaces a range with multi-line content", () => {
    const raw = "a\nb\nc\n";
    const out = applyLinePatches(raw, [
      { start_line: 2, end_line: 2, content: "B1\nB2\nB3" },
    ]);
    expect(out).toBe("a\nB1\nB2\nB3\nc\n");
  });

  test("appends when start_line is past the last line", () => {
    const raw = "a\nb\n";
    const out = applyLinePatches(raw, [
      { start_line: 99, end_line: 0, content: "Z" },
    ]);
    expect(out.endsWith("Z")).toBe(true);
    expect(out.split("\n")).toContain("a");
    expect(out.split("\n")).toContain("b");
  });

  test("noop when patches array is empty", () => {
    const raw = "a\nb\nc\n";
    expect(applyLinePatches(raw, [])).toBe(raw);
  });

  test("LinePatchSchema accepts a valid patch", () => {
    const ok = LinePatchSchema.safeParse({
      start_line: 1,
      end_line: 1,
      content: "x",
    });
    expect(ok.success).toBe(true);
  });

  test("LinePatchSchema rejects non-numeric line fields", () => {
    const bad = LinePatchSchema.safeParse({
      start_line: "1",
      end_line: 1,
      content: "x",
    });
    expect(bad.success).toBe(false);
  });
});
