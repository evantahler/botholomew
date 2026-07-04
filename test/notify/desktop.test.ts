import { describe, expect, test } from "bun:test";
import { buildDesktopCommand } from "../../src/notify/desktop.ts";
import type { Notification } from "../../src/notify/dispatch.ts";

const n: Notification = { title: "Hi", message: "hello world" };

describe("buildDesktopCommand", () => {
  test("darwin + terminal-notifier uses argv (no escaping needed)", () => {
    expect(buildDesktopCommand("darwin", true, n)).toEqual({
      cmd: "terminal-notifier",
      args: ["-title", "Hi", "-message", "hello world"],
    });
  });

  test("darwin fallback builds an osascript display-notification", () => {
    expect(buildDesktopCommand("darwin", false, n)).toEqual({
      cmd: "osascript",
      args: ["-e", 'display notification "hello world" with title "Hi"'],
    });
  });

  test("osascript fallback escapes quotes and backslashes", () => {
    const cmd = buildDesktopCommand("darwin", false, {
      title: 'a"b',
      message: "c\\d",
    });
    expect(cmd).toEqual({
      cmd: "osascript",
      args: ["-e", 'display notification "c\\\\d" with title "a\\"b"'],
    });
  });

  test("linux uses notify-send argv", () => {
    expect(buildDesktopCommand("linux", false, n)).toEqual({
      cmd: "notify-send",
      args: ["Hi", "hello world"],
    });
  });

  test("unsupported platforms are a no-op (null)", () => {
    expect(buildDesktopCommand("win32", false, n)).toBeNull();
  });

  test("terminal-notifier includes the owl icon when a path is given", () => {
    expect(buildDesktopCommand("darwin", true, n, "/tmp/owl.png")).toEqual({
      cmd: "terminal-notifier",
      args: [
        "-title",
        "Hi",
        "-message",
        "hello world",
        "-appIcon",
        "/tmp/owl.png",
        "-contentImage",
        "/tmp/owl.png",
      ],
    });
  });

  test("notify-send prepends -i with the icon path", () => {
    expect(buildDesktopCommand("linux", false, n, "/tmp/owl.png")).toEqual({
      cmd: "notify-send",
      args: ["-i", "/tmp/owl.png", "Hi", "hello world"],
    });
  });

  test("osascript fallback ignores the icon (can't show one)", () => {
    expect(buildDesktopCommand("darwin", false, n, "/tmp/owl.png")).toEqual({
      cmd: "osascript",
      args: ["-e", 'display notification "hello world" with title "Hi"'],
    });
  });
});
