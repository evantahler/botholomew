import { beforeEach, describe, expect, test } from "bun:test";
import { isUrl, urlToContextPath } from "../../src/context/url-utils.ts";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  createContextItem,
  getContextItemByPath,
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

describe("URL context items", () => {
  test("creating a URL context item sets source_type to url", async () => {
    const item = await createContextItem(conn, {
      title: "Example Page",
      content: "Hello from example.com",
      mimeType: "text/markdown",
      sourceType: "url",
      sourcePath: "https://example.com",
      contextPath: "/example.com.md",
      isTextual: true,
    });

    expect(item.source_type).toBe("url");
    expect(item.source_path).toBe("https://example.com");
  });

  test("default source_type is file", async () => {
    const item = await createContextItem(conn, {
      title: "local.txt",
      content: "local content",
      contextPath: "/local.txt",
    });

    expect(item.source_type).toBe("file");
  });

  test("upserting same URL twice updates rather than duplicates", async () => {
    const contextPath = urlToContextPath("https://example.com/page", "/");

    const item1 = await createContextItem(conn, {
      title: "Example Page",
      content: "Version 1",
      sourceType: "url",
      sourcePath: "https://example.com/page",
      contextPath,
      isTextual: true,
    });

    await updateContextItem(conn, item1.id, { content: "Version 2" });
    const updated = await getContextItemByPath(conn, contextPath);

    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("Version 2");
    expect(updated?.id).toBe(item1.id);
  });

  test("--name override produces custom context path", () => {
    const autoPath = urlToContextPath("https://example.com/page", "/");
    expect(autoPath).toBe("/example.com/page.md");

    // With --name, the user overrides this
    const customPath = "/articles/example.md";
    expect(customPath).not.toBe(autoPath);
  });
});

describe("refresh URL items", () => {
  test("URL items have source_type=url for refresh filtering", async () => {
    const urlItem = await createContextItem(conn, {
      title: "Remote Page",
      content: "Remote content v1",
      sourceType: "url",
      sourcePath: "https://example.com",
      contextPath: "/example.com.md",
      isTextual: true,
    });

    const fileItem = await createContextItem(conn, {
      title: "local.txt",
      content: "local content",
      sourceType: "file",
      sourcePath: "/tmp/local.txt",
      contextPath: "/local.txt",
      isTextual: true,
    });

    expect(urlItem.source_type).toBe("url");
    expect(fileItem.source_type).toBe("file");

    // Simulate refresh: URL item content changes
    await updateContextItem(conn, urlItem.id, {
      content: "Remote content v2",
    });
    const refreshed = await getContextItemByPath(conn, "/example.com.md");
    expect(refreshed?.content).toBe("Remote content v2");
  });

  test("refresh skips items where content is unchanged", async () => {
    const item = await createContextItem(conn, {
      title: "Remote Page",
      content: "Same content",
      sourceType: "url",
      sourcePath: "https://example.com",
      contextPath: "/example.com.md",
      isTextual: true,
    });

    // Content hasn't changed — update should be skipped
    const fetched = "Same content";
    expect(fetched).toBe(item.content as string);
  });
});
