import { describe, expect, test } from "bun:test";
import type { UpdateCache } from "../../src/update/checker.ts";
import { isNewerVersion, needsCheck } from "../../src/update/checker.ts";

describe("isNewerVersion", () => {
  test("returns true when latest is newer", () => {
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
  });

  test("returns false when versions are equal", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  test("returns false when current is newer", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.1.0", "1.0.0")).toBe(false);
  });
});

describe("needsCheck", () => {
  test("returns true when cache is undefined", () => {
    expect(needsCheck(undefined)).toBe(true);
  });

  test("returns true when cache has no lastCheckAt", () => {
    expect(
      needsCheck({ latestVersion: "1.0.0", hasUpdate: false } as UpdateCache),
    ).toBe(true);
  });

  test("returns true when cache is older than 24 hours", () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(
      needsCheck({
        lastCheckAt: oldDate,
        latestVersion: "1.0.0",
        hasUpdate: false,
      }),
    ).toBe(true);
  });

  test("returns false when cache is fresh", () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(
      needsCheck({
        lastCheckAt: recentDate,
        latestVersion: "1.0.0",
        hasUpdate: false,
      }),
    ).toBe(false);
  });
});
