import { beforeEach, describe, expect, test } from "bun:test";
import { detectDriveFromUrl } from "../../src/context/drives.ts";
import { isUrl } from "../../src/context/url-utils.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  createContextItem,
  getContextItem,
  updateContextItem,
} from "../../src/db/context.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("URL detection", () => {
  test("isUrl correctly identifies URLs in mixed paths", () => {
    expect(isUrl("https://example.com")).toBe(true);
    expect(isUrl("./local-file.txt")).toBe(false);
    expect(isUrl("/absolute/path")).toBe(false);
  });
});

describe("URL → drive routing", () => {
  test("arbitrary URL routes to url:/<full-url>", () => {
    expect(detectDriveFromUrl("https://example.com/post")).toEqual({
      drive: "url",
      path: "/https://example.com/post",
    });
  });

  test("google docs URL routes to google-docs drive", () => {
    expect(
      detectDriveFromUrl("https://docs.google.com/document/d/abc/edit"),
    ).toEqual({
      drive: "google-docs",
      path: "/abc",
    });
  });
});

describe("URL context items", () => {
  test("creating a URL context item with drive=url", async () => {
    const item = await createContextItem(conn, {
      title: "Example Page",
      content: "Hello from example.com",
      mimeType: "text/markdown",
      drive: "url",
      path: "/https://example.com",
      isTextual: true,
    });

    expect(item.drive).toBe("url");
    expect(item.path).toBe("/https://example.com");
  });

  test("upserting same URL twice updates rather than duplicates", async () => {
    const target = detectDriveFromUrl("https://example.com/page");

    const item1 = await createContextItem(conn, {
      title: "Example Page",
      content: "Version 1",
      drive: target.drive,
      path: target.path,
      isTextual: true,
    });

    await updateContextItem(conn, item1.id, { content: "Version 2" });
    const updated = await getContextItem(conn, target);

    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("Version 2");
    expect(updated?.id).toBe(item1.id);
  });
});

describe("URL refresh", () => {
  test("URL items live under non-disk drives for refresh dispatch", async () => {
    const urlItem = await createContextItem(conn, {
      title: "Remote Page",
      content: "Remote content v1",
      drive: "url",
      path: "/https://example.com",
      isTextual: true,
    });

    const fileItem = await createContextItem(conn, {
      title: "local.txt",
      content: "local content",
      drive: "disk",
      path: "/tmp/local.txt",
      isTextual: true,
    });

    expect(urlItem.drive).toBe("url");
    expect(fileItem.drive).toBe("disk");

    await updateContextItem(conn, urlItem.id, {
      content: "Remote content v2",
    });
    const refreshed = await getContextItem(conn, {
      drive: "url",
      path: "/https://example.com",
    });
    expect(refreshed?.content).toBe("Remote content v2");
  });
});
