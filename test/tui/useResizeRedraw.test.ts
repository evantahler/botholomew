import { describe, expect, test } from "bun:test";
import { createResizeRedrawController } from "../../src/tui/hooks/useResizeRedraw.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createResizeRedrawController", () => {
  test("first onResize only records the baseline (no redraw)", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24);
    await wait(40);
    expect(redraws).toBe(0);
    c.dispose();
  });

  test("no redraw when dimensions are unchanged", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24);
    c.onResize(80, 24);
    c.onResize(80, 24);
    await wait(40);
    expect(redraws).toBe(0);
    c.dispose();
  });

  test("fires a single trailing redraw after debounce for a real change", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24); // baseline
    c.onResize(60, 24); // width shrink
    expect(redraws).toBe(0); // debounced, not yet fired
    await wait(40);
    expect(redraws).toBe(1);
    c.dispose();
  });

  test("detects a rows-only change", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24); // baseline
    c.onResize(80, 12); // rows shrink
    await wait(40);
    expect(redraws).toBe(1);
    c.dispose();
  });

  test("rapid successive resizes coalesce into one redraw", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24); // baseline
    c.onResize(70, 24);
    c.onResize(60, 22);
    c.onResize(50, 20);
    await wait(40);
    expect(redraws).toBe(1);
    c.dispose();
  });

  test("dispose cancels a pending redraw", async () => {
    let redraws = 0;
    const c = createResizeRedrawController(() => redraws++, { debounceMs: 20 });
    c.onResize(80, 24); // baseline
    c.onResize(60, 24); // schedules redraw
    c.dispose();
    await wait(40);
    expect(redraws).toBe(0);
  });
});
