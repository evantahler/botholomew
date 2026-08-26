import { describe, expect, test } from "bun:test";
import {
  clipboardCommands,
  isSafeUrl,
  openCommand,
  openUrl,
} from "../../src/tui/shellOpen.ts";

const OAUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=a+b&state=6f1d0c2a";

describe("isSafeUrl", () => {
  test("accepts http and https", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl(OAUTH_URL)).toBe(true);
  });

  test("rejects other schemes", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script/>")).toBe(false);
    expect(isSafeUrl("mailto:a@b.com")).toBe(false);
  });

  test("rejects garbage", () => {
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("openCommand", () => {
  test("macOS uses open", () => {
    expect(openCommand("darwin", OAUTH_URL)).toEqual(["open", OAUTH_URL]);
  });

  test("linux uses xdg-open", () => {
    expect(openCommand("linux", OAUTH_URL)).toEqual(["xdg-open", OAUTH_URL]);
  });

  // `cmd /c start` re-parses its argument through the shell, where the `&`
  // in every OAuth query string is a command separator.
  test("windows avoids cmd start", () => {
    const argv = openCommand("win32", OAUTH_URL);
    expect(argv[0]).toBe("rundll32");
    expect(argv).not.toContain("cmd");
    expect(argv[argv.length - 1]).toBe(OAUTH_URL);
  });

  test("the URL is always a single argv entry, never interpolated", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const argv = openCommand(platform, OAUTH_URL);
      expect(argv.filter((a) => a === OAUTH_URL)).toHaveLength(1);
      expect(argv.some((a) => a.includes(" ") && a.includes(OAUTH_URL))).toBe(
        false,
      );
    }
  });
});

describe("clipboardCommands", () => {
  test("macOS", () => {
    expect(clipboardCommands("darwin")).toEqual([["pbcopy"]]);
  });

  test("windows", () => {
    expect(clipboardCommands("win32")).toEqual([["clip"]]);
  });

  test("linux offers wayland then X fallbacks, in order", () => {
    expect(clipboardCommands("linux").map((c) => c[0])).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ]);
  });
});

describe("openUrl", () => {
  test("refuses an unsafe URL without spawning", async () => {
    const result = await openUrl("file:///etc/passwd", "darwin");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("http(s)");
  });
});
