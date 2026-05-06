import { describe, expect, test } from "bun:test";
import { shouldBeIdle } from "../../src/tui/idle.tsx";

describe("shouldBeIdle", () => {
  const TIMEOUT = 180_000;

  test("fresh activity is not idle", () => {
    const now = 1_000_000;
    expect(shouldBeIdle(now, now, TIMEOUT)).toBe(false);
  });

  test("activity within the window is not idle", () => {
    const last = 1_000_000;
    expect(shouldBeIdle(last, last + TIMEOUT - 1, TIMEOUT)).toBe(false);
  });

  test("activity exactly at the threshold is idle", () => {
    const last = 1_000_000;
    expect(shouldBeIdle(last, last + TIMEOUT, TIMEOUT)).toBe(true);
  });

  test("activity past the threshold is idle", () => {
    const last = 1_000_000;
    expect(shouldBeIdle(last, last + TIMEOUT + 1, TIMEOUT)).toBe(true);
  });

  test("timeout of 0 disables idle detection", () => {
    const last = 1_000_000;
    expect(shouldBeIdle(last, last + 10 * TIMEOUT, 0)).toBe(false);
  });

  test("negative timeout disables idle detection", () => {
    const last = 1_000_000;
    expect(shouldBeIdle(last, last + 10 * TIMEOUT, -1)).toBe(false);
  });
});
