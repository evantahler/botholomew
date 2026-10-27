import { describe, expect, test } from "bun:test";
import { createDeleteConfirmController } from "../../src/tui/useDeleteConfirm.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createDeleteConfirmController", () => {
  test("first press arms and stores label", () => {
    let confirms = 0;
    const c = createDeleteConfirmController(() => confirms++, { ttlMs: 50 });
    expect(c.isArmed()).toBe(false);
    expect(c.armedLabel()).toBeNull();
    c.pressDelete("hello");
    expect(c.isArmed()).toBe(true);
    expect(c.armedLabel()).toBe("hello");
    expect(confirms).toBe(0);
    c.dispose();
  });

  test("second press within TTL fires onConfirm and disarms", () => {
    let confirms = 0;
    const c = createDeleteConfirmController(() => confirms++, { ttlMs: 50 });
    c.pressDelete("a");
    c.pressDelete("a");
    expect(confirms).toBe(1);
    expect(c.isArmed()).toBe(false);
    expect(c.armedLabel()).toBeNull();
    c.dispose();
  });

  test("auto-disarms after TTL; subsequent press only re-arms", async () => {
    let confirms = 0;
    const c = createDeleteConfirmController(() => confirms++, { ttlMs: 30 });
    c.pressDelete("a");
    await wait(60);
    expect(c.isArmed()).toBe(false);
    c.pressDelete("a");
    expect(confirms).toBe(0);
    expect(c.isArmed()).toBe(true);
    c.dispose();
  });

  test("cancel disarms and prevents the next press from confirming", () => {
    let confirms = 0;
    const c = createDeleteConfirmController(() => confirms++, { ttlMs: 50 });
    c.pressDelete("a");
    c.cancel();
    expect(c.isArmed()).toBe(false);
    c.pressDelete("a");
    expect(confirms).toBe(0);
    expect(c.isArmed()).toBe(true);
    c.dispose();
  });

  test("onChange fires on arm, confirm, cancel, and TTL expiry", async () => {
    let changes = 0;
    const c = createDeleteConfirmController(() => {}, {
      ttlMs: 30,
      onChange: () => changes++,
    });
    c.pressDelete("a");
    expect(changes).toBe(1);
    c.cancel();
    expect(changes).toBe(2);
    c.pressDelete("b");
    expect(changes).toBe(3);
    await wait(60);
    expect(changes).toBe(4);
    c.pressDelete("c");
    c.pressDelete("c");
    expect(changes).toBe(6);
    c.dispose();
  });

  test("dispose clears pending TTL timer", async () => {
    let changes = 0;
    const c = createDeleteConfirmController(() => {}, {
      ttlMs: 20,
      onChange: () => changes++,
    });
    c.pressDelete("a");
    c.dispose();
    await wait(40);
    expect(changes).toBe(1);
  });
});
