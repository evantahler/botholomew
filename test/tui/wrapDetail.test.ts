import { describe, expect, test } from "bun:test";
import { clampScroll } from "../../src/tui/wrapDetail.ts";

describe("clampScroll", () => {
  test("returns scroll unchanged when in range", () => {
    expect(clampScroll(0, 80)).toBe(0);
    expect(clampScroll(40, 80)).toBe(40);
    expect(clampScroll(80, 80)).toBe(80);
  });

  test("pins MAX_SAFE_INTEGER sentinel to maxScroll (tail-mode bug fix)", () => {
    // Threads-pane follow mode sets detailScroll to MAX_SAFE_INTEGER as a
    // "stay-at-bottom" signal. Without this clamp, Array.slice returned []
    // and the detail pane went blank every time a new interaction streamed
    // in. Regression guard.
    expect(clampScroll(Number.MAX_SAFE_INTEGER, 80)).toBe(80);
    expect(clampScroll(Number.MAX_SAFE_INTEGER, 0)).toBe(0);
  });

  test("clamps negatives to zero", () => {
    expect(clampScroll(-5, 80)).toBe(0);
    expect(clampScroll(-Number.MAX_SAFE_INTEGER, 80)).toBe(0);
  });

  test("handles negative maxScroll defensively", () => {
    // Could happen if detailLines.length < visibleRows and someone forgets
    // the Math.max(0, ...) on maxScroll itself.
    expect(clampScroll(0, -5)).toBe(0);
    expect(clampScroll(10, -5)).toBe(0);
  });

  test("slice with clamped scroll yields the trailing window", () => {
    // The actual usage in ThreadPanel: slice(safeScroll, safeScroll + visibleRows).
    const detailLines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const visibleRows = 20;
    const maxScroll = detailLines.length - visibleRows; // 80
    const safe = clampScroll(Number.MAX_SAFE_INTEGER, maxScroll);
    const window = detailLines.slice(safe, safe + visibleRows);
    expect(window).toHaveLength(20);
    expect(window[0]).toBe("line 80");
    expect(window[19]).toBe("line 99");
  });
});
