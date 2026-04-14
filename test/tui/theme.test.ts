import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

describe("theme", () => {
  let originalColorfgbg: string | undefined;

  beforeEach(() => {
    originalColorfgbg = process.env.COLORFGBG;
  });

  afterEach(() => {
    if (originalColorfgbg === undefined) {
      delete process.env.COLORFGBG;
    } else {
      process.env.COLORFGBG = originalColorfgbg;
    }
  });

  function loadTheme() {
    // Re-import to pick up env changes
    delete require.cache[require.resolve("../../src/tui/theme.ts")];
    return require("../../src/tui/theme.ts");
  }

  // --- COLORFGBG detection (takes priority) ---

  test("detects dark background from COLORFGBG", () => {
    process.env.COLORFGBG = "15;0";
    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(true);
  });

  test("detects light background from COLORFGBG", () => {
    process.env.COLORFGBG = "0;15";
    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(false);
  });

  test("detects light background with bg=7", () => {
    process.env.COLORFGBG = "0;7";
    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(false);
  });

  test("detects dark background with bg=6", () => {
    process.env.COLORFGBG = "15;6";
    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(true);
  });

  test("handles three-part COLORFGBG (rxvt style)", () => {
    process.env.COLORFGBG = "0;default;15";
    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(false);
  });

  test("falls through on malformed COLORFGBG", () => {
    process.env.COLORFGBG = "garbage";
    const { detectDarkBackground } = loadTheme();
    // Falls through to macOS detection or default
    expect(typeof detectDarkBackground()).toBe("boolean");
  });

  test("falls through on empty COLORFGBG", () => {
    process.env.COLORFGBG = "";
    const { detectDarkBackground } = loadTheme();
    expect(typeof detectDarkBackground()).toBe("boolean");
  });

  // --- macOS fallback ---

  test("without COLORFGBG on macOS, matches system appearance", () => {
    if (process.platform !== "darwin") return; // skip on non-macOS
    delete process.env.COLORFGBG;

    const result = spawnSync(
      "defaults",
      ["read", "-g", "AppleInterfaceStyle"],
      { encoding: "utf-8", timeout: 500 },
    );
    const systemIsDark = result.stdout?.trim() === "Dark";

    const { detectDarkBackground } = loadTheme();
    expect(detectDarkBackground()).toBe(systemIsDark);
  });

  // --- Theme values ---

  test("dark theme uses yellow accent", () => {
    process.env.COLORFGBG = "15;0"; // force dark
    const { theme } = loadTheme();
    expect(theme.accent).toBe("yellow");
    expect(theme.userBg).toBe("#2a4a6c");
    expect(theme.selectionBg).toBe("#333");
  });

  test("light theme uses dark goldenrod accent", () => {
    process.env.COLORFGBG = "0;15"; // force light
    const { theme } = loadTheme();
    expect(theme.accent).toBe("#B8860B");
    expect(theme.userBg).toBe("#d0e0f0");
    expect(theme.selectionBg).toBe("#ddd");
  });
});
