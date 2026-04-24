import { describe, expect, test } from "bun:test";
import {
  detectDriveFromUrl,
  formatDriveRef,
  parseDriveRef,
} from "../../src/context/drives.ts";

describe("parseDriveRef", () => {
  test("parses disk:/abs/path", () => {
    expect(parseDriveRef("disk:/Users/evan/foo.md")).toEqual({
      drive: "disk",
      path: "/Users/evan/foo.md",
    });
  });

  test("parses google-docs:/id", () => {
    expect(parseDriveRef("google-docs:/abc123")).toEqual({
      drive: "google-docs",
      path: "/abc123",
    });
  });

  test("rejects refs without /", () => {
    expect(parseDriveRef("disk:relative")).toBeNull();
  });

  test("rejects bare paths with no drive", () => {
    expect(parseDriveRef("/foo/bar")).toBeNull();
  });

  test("rejects invalid drive names", () => {
    expect(parseDriveRef("1bad:/path")).toBeNull();
    expect(parseDriveRef("BAD:/path")).toBeNull();
  });
});

describe("formatDriveRef", () => {
  test("renders drive:/path", () => {
    expect(formatDriveRef({ drive: "disk", path: "/a/b" })).toBe("disk:/a/b");
  });
});

describe("detectDriveFromUrl", () => {
  test("Google Docs doc URL → google-docs drive with doc id", () => {
    expect(
      detectDriveFromUrl(
        "https://docs.google.com/document/d/1AbCDEFGhijk/edit",
      ),
    ).toEqual({ drive: "google-docs", path: "/1AbCDEFGhijk" });
  });

  test("Google Sheets URL → google-docs drive with doc id", () => {
    expect(
      detectDriveFromUrl("https://docs.google.com/spreadsheets/d/xyz789/edit"),
    ).toEqual({ drive: "google-docs", path: "/xyz789" });
  });

  test("GitHub blob URL → github drive with owner/repo/path", () => {
    expect(
      detectDriveFromUrl(
        "https://github.com/evantahler/botholomew/blob/main/README.md",
      ),
    ).toEqual({
      drive: "github",
      path: "/evantahler/botholomew/README.md",
    });
  });

  test("GitHub tree URL → github drive with owner/repo/path", () => {
    expect(
      detectDriveFromUrl(
        "https://github.com/evantahler/botholomew/tree/main/src",
      ),
    ).toEqual({
      drive: "github",
      path: "/evantahler/botholomew/src",
    });
  });

  test("raw.githubusercontent.com → github drive", () => {
    expect(
      detectDriveFromUrl(
        "https://raw.githubusercontent.com/evantahler/botholomew/main/README.md",
      ),
    ).toEqual({
      drive: "github",
      path: "/evantahler/botholomew/README.md",
    });
  });

  test("GitHub repo root → github drive with owner/repo", () => {
    expect(
      detectDriveFromUrl("https://github.com/evantahler/botholomew"),
    ).toEqual({
      drive: "github",
      path: "/evantahler/botholomew",
    });
  });

  test("unknown URL → url drive with full URL as path", () => {
    expect(detectDriveFromUrl("https://example.com/post")).toEqual({
      drive: "url",
      path: "/https://example.com/post",
    });
  });

  test("MCP server-name hint 'Google Docs' pushes generic URL into google-docs drive", () => {
    // We don't have a doc id in this URL so it still falls back to url,
    // but an explicit Google Docs URL hits the hint successfully.
    expect(
      detectDriveFromUrl(
        "https://docs.google.com/document/d/zzz/edit",
        "Google Docs Gateway",
      ),
    ).toEqual({ drive: "google-docs", path: "/zzz" });
  });

  test("unparseable input → url drive", () => {
    expect(detectDriveFromUrl("not a url")).toEqual({
      drive: "url",
      path: "/not a url",
    });
  });
});
