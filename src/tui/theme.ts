/**
 * Terminal-background-aware color theme for the TUI.
 *
 * Detection order:
 * 1. COLORFGBG env var (set by Terminal.app, iTerm2, xterm)
 * 2. macOS system appearance via `defaults read -g AppleInterfaceStyle`
 * 3. Falls back to dark theme
 */

import { spawnSync } from "node:child_process";

function detectDarkBackground(): boolean {
  // 1. Check COLORFGBG env var
  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (!Number.isNaN(bg)) {
      // Standard terminal colors: 0-6 are dark, 7+ are light
      return bg <= 6;
    }
  }

  // 2. On macOS, check system appearance
  if (process.platform === "darwin") {
    try {
      const result = spawnSync(
        "defaults",
        ["read", "-g", "AppleInterfaceStyle"],
        { encoding: "utf-8", timeout: 500 },
      );
      // Returns "Dark" in dark mode; exits non-zero in light mode
      return result.stdout?.trim() === "Dark";
    } catch {
      // fall through to default
    }
  }

  return true; // default to dark
}

const isDark = detectDarkBackground();

export const theme = {
  accent: isDark ? "yellow" : "#B8860B",
  accentBorder: isDark ? "yellow" : "#B8860B",
  userBg: isDark ? "#1a3a5c" : "#d0e0f0",
  selectionBg: isDark ? "#333" : "#ddd",
  success: "green",
  error: "red",
  info: "cyan",
  primary: "blue",
  toolName: "magenta",
  muted: "gray",
} as const;

// Exported for testing
export { detectDarkBackground };
