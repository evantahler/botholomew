import { describe, expect, test } from "bun:test";
import { sanitizePathForServiceName } from "../../src/constants.ts";
import {
  detectPlatform,
  generateLaunchdPlist,
  generateSystemdService,
  generateSystemdTimer,
  generateWatchdogConfig,
} from "../../src/daemon/watchdog.ts";

describe("sanitizePathForServiceName", () => {
  test("converts absolute path to lowercase dash-separated string", () => {
    expect(sanitizePathForServiceName("/Users/evan/myproject")).toBe(
      "users-evan-myproject",
    );
  });

  test("handles trailing slashes", () => {
    expect(sanitizePathForServiceName("/Users/evan/myproject/")).toBe(
      "users-evan-myproject",
    );
  });

  test("collapses multiple slashes", () => {
    expect(sanitizePathForServiceName("/Users//evan///myproject")).toBe(
      "users-evan-myproject",
    );
  });

  test("handles backslashes (Windows-style)", () => {
    expect(sanitizePathForServiceName("C:\\Users\\evan\\myproject")).toBe(
      "c-users-evan-myproject",
    );
  });

  test("different paths produce different names", () => {
    const a = sanitizePathForServiceName("/home/alice/project-a");
    const b = sanitizePathForServiceName("/home/bob/project-b");
    expect(a).not.toBe(b);
  });
});

describe("detectPlatform", () => {
  test("returns macos or linux on supported platforms", () => {
    const platform = detectPlatform();
    expect(["macos", "linux"]).toContain(platform);
  });
});

describe("generateLaunchdPlist", () => {
  const projectDir = "/Users/evan/myproject";
  const cmd = ["bun", "run", "/path/to/healthcheck.ts", projectDir];

  test("generates valid XML plist", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<!DOCTYPE plist");
    expect(plist).toContain('<plist version="1.0">');
  });

  test("includes correct label", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain("com.botholomew.users-evan-myproject");
  });

  test("includes StartInterval of 60", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>60</integer>");
  });

  test("has KeepAlive false", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<false/>");
  });

  test("includes program arguments", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain("<string>bun</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<string>/path/to/healthcheck.ts</string>");
  });

  test("includes watchdog log paths", () => {
    const plist = generateLaunchdPlist(projectDir, cmd);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("watchdog.log");
  });

  test("escapes XML special characters in paths", () => {
    const dirWithSpecial = "/Users/evan/my&project";
    const plist = generateLaunchdPlist(dirWithSpecial, [
      "bun",
      "run",
      "hc.ts",
      dirWithSpecial,
    ]);
    expect(plist).toContain("my&amp;project");
    expect(plist).not.toContain("my&project");
  });
});

describe("generateSystemdService", () => {
  const projectDir = "/home/evan/myproject";
  const cmd = ["bun", "run", "/path/to/healthcheck.ts", projectDir];

  test("generates valid service unit", () => {
    const service = generateSystemdService(projectDir, cmd);
    expect(service).toContain("[Unit]");
    expect(service).toContain("[Service]");
    expect(service).toContain("[Install]");
  });

  test("is Type=oneshot", () => {
    const service = generateSystemdService(projectDir, cmd);
    expect(service).toContain("Type=oneshot");
  });

  test("includes ExecStart with full command", () => {
    const service = generateSystemdService(projectDir, cmd);
    expect(service).toContain(
      "ExecStart=bun run /path/to/healthcheck.ts /home/evan/myproject",
    );
  });

  test("includes project dir in description", () => {
    const service = generateSystemdService(projectDir, cmd);
    expect(service).toContain(projectDir);
  });
});

describe("generateSystemdTimer", () => {
  test("generates valid timer unit", () => {
    const timer = generateSystemdTimer("botholomew-home-evan-myproject");
    expect(timer).toContain("[Unit]");
    expect(timer).toContain("[Timer]");
    expect(timer).toContain("[Install]");
  });

  test("fires on boot and every 60 seconds", () => {
    const timer = generateSystemdTimer("botholomew-home-evan-myproject");
    expect(timer).toContain("OnBootSec=60");
    expect(timer).toContain("OnUnitActiveSec=60");
  });

  test("includes service name in description", () => {
    const timer = generateSystemdTimer("botholomew-home-evan-myproject");
    expect(timer).toContain("botholomew-home-evan-myproject");
  });
});

describe("generateWatchdogConfig", () => {
  const projectDir = "/Users/evan/myproject";

  test("returns platform and files array", () => {
    const config = generateWatchdogConfig(projectDir);
    expect(config.platform).toBeDefined();
    expect(Array.isArray(config.files)).toBe(true);
    expect(config.files.length).toBeGreaterThan(0);
  });

  test("each file has path and content", () => {
    const config = generateWatchdogConfig(projectDir);
    for (const file of config.files) {
      expect(file.path).toBeTruthy();
      expect(file.content).toBeTruthy();
    }
  });

  test("macOS config has single plist file", () => {
    const config = generateWatchdogConfig(projectDir);
    if (config.platform === "macos") {
      expect(config.files).toHaveLength(1);
      const plistFile = config.files[0];
      expect(plistFile?.path).toContain(".plist");
      expect(plistFile?.path).toContain("LaunchAgents");
    }
  });

  test("linux config has service and timer files", () => {
    const config = generateWatchdogConfig(projectDir);
    if (config.platform === "linux") {
      expect(config.files).toHaveLength(2);
      expect(config.files.some((f) => f.path.endsWith(".service"))).toBe(true);
      expect(config.files.some((f) => f.path.endsWith(".timer"))).toBe(true);
    }
  });
});
