import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import {
  applyPatchesToContextItem,
  contextPathExists,
  copyContextItem,
  createContextItem,
  createContextItemStrict,
  deleteContextItem,
  deleteContextItemByPath,
  deleteContextItemsByPrefix,
  getContextItem,
  getContextItemByPath,
  getContextItemBySourcePath,
  getDistinctDirectories,
  listContextItems,
  listContextItemsByPrefix,
  moveContextItem,
  PathConflictError,
  searchContextByKeyword,
  updateContextItem,
  updateContextItemContent,
  upsertContextItem,
} from "../../src/db/context.ts";
import { setupTestDb } from "../helpers.ts";

let conn: DbConnection;

beforeEach(async () => {
  conn = await setupTestDb();
});

describe("context CRUD", () => {
  test("create and get by id", async () => {
    const item = await createContextItem(conn, {
      title: "Test",
      content: "Hello world",
      contextPath: "/docs/test.md",
    });
    expect(item.id).toBeTruthy();
    expect(item.title).toBe("Test");
    expect(item.content).toBe("Hello world");
    expect(item.context_path).toBe("/docs/test.md");
    expect(item.mime_type).toBe("text/plain");

    const fetched = await getContextItem(conn, item.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe("Test");
  });

  test("duplicate context_path is rejected by unique index", async () => {
    await createContextItem(conn, {
      title: "First",
      content: "v1",
      contextPath: "/docs/test.md",
    });

    await expect(
      createContextItem(conn, {
        title: "Second",
        content: "v2",
        contextPath: "/docs/test.md",
      }),
    ).rejects.toThrow();

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
    expect(items[0]?.content).toBe("v1");
  });

  test("upsert: adding same path twice updates instead of duplicating", async () => {
    const path = "/docs/test.md";

    // First add
    await createContextItem(conn, {
      title: "Original",
      content: "v1",
      contextPath: path,
    });

    // Simulate the upsert pattern from addFile()
    const existing = await getContextItemByPath(conn, path);
    if (!existing) throw new Error("expected existing item");

    const updated = await updateContextItem(conn, existing.id, {
      title: "Updated",
      content: "v2",
      mime_type: "text/markdown",
    });

    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("v2");
    expect(updated?.title).toBe("Updated");
    expect(updated?.mime_type).toBe("text/markdown");
    expect(updated?.id).toBe(existing.id);

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
  });

  test("createContextItemStrict: inserts when new", async () => {
    const item = await createContextItemStrict(conn, {
      title: "Strict",
      content: "hello",
      contextPath: "/strict/new.md",
    });
    expect(item.title).toBe("Strict");
    expect(item.content).toBe("hello");
    expect(item.context_path).toBe("/strict/new.md");
  });

  test("createContextItemStrict: throws PathConflictError on collision", async () => {
    const first = await createContextItemStrict(conn, {
      title: "Original",
      content: "v1",
      contextPath: "/strict/conflict.md",
    });

    let caught: unknown;
    try {
      await createContextItemStrict(conn, {
        title: "Second",
        content: "v2",
        contextPath: "/strict/conflict.md",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PathConflictError);
    if (caught instanceof PathConflictError) {
      expect(caught.existingId).toBe(first.id);
      expect(caught.contextPath).toBe("/strict/conflict.md");
    }

    // Original content preserved; no new row
    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
    expect(items[0]?.content).toBe("v1");
  });

  test("upsertContextItem: insert when new", async () => {
    const item = await upsertContextItem(conn, {
      title: "New File",
      content: "hello",
      contextPath: "/docs/new.md",
    });
    expect(item.title).toBe("New File");
    expect(item.content).toBe("hello");
    expect(item.context_path).toBe("/docs/new.md");

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
  });

  test("upsertContextItem: update when exists", async () => {
    const original = await upsertContextItem(conn, {
      title: "V1",
      content: "first",
      contextPath: "/docs/test.md",
    });

    const updated = await upsertContextItem(conn, {
      title: "V2",
      content: "second",
      contextPath: "/docs/test.md",
      mimeType: "text/markdown",
    });

    expect(updated.id).toBe(original.id);
    expect(updated.title).toBe("V2");
    expect(updated.content).toBe("second");
    expect(updated.mime_type).toBe("text/markdown");

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
  });

  test("upsertContextItem: preserves created_at on update", async () => {
    const original = await upsertContextItem(conn, {
      title: "V1",
      content: "first",
      contextPath: "/docs/test.md",
    });

    const updated = await upsertContextItem(conn, {
      title: "V2",
      content: "second",
      contextPath: "/docs/test.md",
    });

    expect(updated.created_at.getTime()).toBe(original.created_at.getTime());
  });

  test("get by path", async () => {
    await createContextItem(conn, {
      title: "Notes",
      content: "Some notes",
      contextPath: "/notes/meeting.md",
    });

    const item = await getContextItemByPath(conn, "/notes/meeting.md");
    expect(item).not.toBeNull();
    expect(item?.title).toBe("Notes");

    const missing = await getContextItemByPath(conn, "/nonexistent");
    expect(missing).toBeNull();
  });

  test("get by source_path scoped to source_type", async () => {
    await createContextItem(conn, {
      title: "mcpx",
      content: "mcpx docs",
      sourceType: "file",
      sourcePath: "/Users/me/docs/mcpx.md",
      contextPath: "/user-guides/mcpx.md",
    });
    await createContextItem(conn, {
      title: "Example",
      content: "remote",
      sourceType: "url",
      sourcePath: "https://example.com",
      contextPath: "/example.com.md",
    });

    const byFile = await getContextItemBySourcePath(
      conn,
      "/Users/me/docs/mcpx.md",
      "file",
    );
    expect(byFile?.context_path).toBe("/user-guides/mcpx.md");

    const byUrl = await getContextItemBySourcePath(
      conn,
      "https://example.com",
      "url",
    );
    expect(byUrl?.context_path).toBe("/example.com.md");

    // source_type discriminates — looking up a URL string under "file" misses.
    const miss = await getContextItemBySourcePath(
      conn,
      "https://example.com",
      "file",
    );
    expect(miss).toBeNull();

    const unknown = await getContextItemBySourcePath(
      conn,
      "/not/ingested.md",
      "file",
    );
    expect(unknown).toBeNull();
  });

  test("list with filters", async () => {
    await createContextItem(conn, {
      title: "A",
      contextPath: "/a.md",
      content: "a",
    });
    await createContextItem(conn, {
      title: "B",
      contextPath: "/b.json",
      content: "b",
      mimeType: "application/json",
    });

    const all = await listContextItems(conn);
    expect(all.length).toBe(2);

    const jsonOnly = await listContextItems(conn, {
      mimeType: "application/json",
    });
    expect(jsonOnly.length).toBe(1);
    expect(jsonOnly[0]?.title).toBe("B");
  });
});

describe("filesystem queries", () => {
  beforeEach(async () => {
    await createContextItem(conn, {
      title: "Root",
      contextPath: "/readme.md",
      content: "root",
    });
    await createContextItem(conn, {
      title: "Notes 1",
      contextPath: "/notes/meeting.md",
      content: "meeting notes",
    });
    await createContextItem(conn, {
      title: "Notes 2",
      contextPath: "/notes/ideas.md",
      content: "ideas",
    });
    await createContextItem(conn, {
      title: "Deep",
      contextPath: "/notes/archive/old.md",
      content: "old stuff",
    });
  });

  test("listByPrefix non-recursive", async () => {
    const items = await listContextItemsByPrefix(conn, "/notes");
    expect(items.length).toBe(2);
    expect(items.map((i) => i.context_path).sort()).toEqual([
      "/notes/ideas.md",
      "/notes/meeting.md",
    ]);
  });

  test("listByPrefix recursive", async () => {
    const items = await listContextItemsByPrefix(conn, "/notes", {
      recursive: true,
    });
    expect(items.length).toBe(3);
  });

  test("contextPathExists", async () => {
    expect(await contextPathExists(conn, "/notes/meeting.md")).toBe(true);
    expect(await contextPathExists(conn, "/nonexistent")).toBe(false);
  });

  test("getDistinctDirectories", async () => {
    const dirs = await getDistinctDirectories(conn, "/notes");
    expect(dirs).toEqual(["/notes/archive"]);
  });
});

describe("mutations", () => {
  test("updateContextItem", async () => {
    const item = await createContextItem(conn, {
      title: "Old",
      contextPath: "/test.md",
      content: "old content",
    });

    const updated = await updateContextItem(conn, item.id, {
      title: "New",
      content: "new content",
    });
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("New");
    expect(updated?.content).toBe("new content");
  });

  test("updateContextItemContent", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "original",
    });

    const updated = await updateContextItemContent(
      conn,
      "/test.md",
      "replaced",
    );
    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("replaced");
  });

  test("applyPatches — replace lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "line1\nline2\nline3\nline4",
    });

    const { item, applied } = await applyPatchesToContextItem(
      conn,
      "/test.md",
      [{ start_line: 2, end_line: 3, content: "replaced" }],
    );

    expect(applied).toBe(1);
    expect(item.content).toBe("line1\nreplaced\nline4");
  });

  test("applyPatches — delete lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "line1\nline2\nline3",
    });

    const { item } = await applyPatchesToContextItem(conn, "/test.md", [
      { start_line: 2, end_line: 2, content: "" },
    ]);

    expect(item.content).toBe("line1\nline3");
  });

  test("applyPatches — insert lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "line1\nline2",
    });

    const { item } = await applyPatchesToContextItem(conn, "/test.md", [
      { start_line: 2, end_line: 0, content: "inserted" },
    ]);

    expect(item.content).toBe("line1\ninserted\nline2");
  });

  test("applyPatches — multiple patches applied bottom-up", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "a\nb\nc\nd\ne",
    });

    const { item } = await applyPatchesToContextItem(conn, "/test.md", [
      { start_line: 2, end_line: 2, content: "B" },
      { start_line: 4, end_line: 4, content: "D" },
    ]);

    expect(item.content).toBe("a\nB\nc\nD\ne");
  });

  test("applyPatches — throws for nonexistent item", async () => {
    await expect(
      applyPatchesToContextItem(conn, "/does-not-exist.md", [
        { start_line: 1, end_line: 1, content: "x" },
      ]),
    ).rejects.toThrow("Not found");
  });

  test("applyPatches — throws for null content", async () => {
    await createContextItem(conn, {
      title: "Binary",
      contextPath: "/binary.bin",
      isTextual: false,
    });

    await expect(
      applyPatchesToContextItem(conn, "/binary.bin", [
        { start_line: 1, end_line: 1, content: "x" },
      ]),
    ).rejects.toThrow("No text content");
  });

  test("applyPatches — out-of-bounds start_line extends content", async () => {
    await createContextItem(conn, {
      title: "Short",
      contextPath: "/short.md",
      content: "only-one-line",
    });

    // start_line 5 on a 1-line file — splice inserts at end
    const { item } = await applyPatchesToContextItem(conn, "/short.md", [
      { start_line: 5, end_line: 0, content: "appended" },
    ]);

    expect(item.content).toContain("only-one-line");
    expect(item.content).toContain("appended");
  });

  test("applyPatches — replace single line with multiple lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "a\nb\nc",
    });

    const { item } = await applyPatchesToContextItem(conn, "/test.md", [
      { start_line: 2, end_line: 2, content: "x\ny\nz" },
    ]);

    expect(item.content).toBe("a\nx\ny\nz\nc");
  });

  test("copyContextItem", async () => {
    await createContextItem(conn, {
      title: "Original",
      contextPath: "/src.md",
      content: "content",
    });

    const copy = await copyContextItem(conn, "/src.md", "/dst.md");
    expect(copy.context_path).toBe("/dst.md");
    expect(copy.content).toBe("content");
    expect(copy.title).toBe("Original");

    // Original still exists
    const original = await getContextItemByPath(conn, "/src.md");
    expect(original).not.toBeNull();
  });

  test("moveContextItem", async () => {
    await createContextItem(conn, {
      title: "Moving",
      contextPath: "/old.md",
      content: "content",
    });

    await moveContextItem(conn, "/old.md", "/new.md");

    expect(await getContextItemByPath(conn, "/old.md")).toBeNull();
    const moved = await getContextItemByPath(conn, "/new.md");
    expect(moved).not.toBeNull();
    expect(moved?.content).toBe("content");
  });
});

describe("deletion", () => {
  test("deleteContextItem by id", async () => {
    const item = await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "x",
    });

    const deleted = await deleteContextItem(conn, item.id);
    expect(deleted).toBe(true);
    expect(await getContextItem(conn, item.id)).toBeNull();
  });

  test("deleteContextItemByPath", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "x",
    });

    const deleted = await deleteContextItemByPath(conn, "/test.md");
    expect(deleted).toBe(true);
    expect(await getContextItemByPath(conn, "/test.md")).toBeNull();
  });

  test("deleteContextItemsByPrefix", async () => {
    await createContextItem(conn, {
      title: "A",
      contextPath: "/dir/a.md",
      content: "a",
    });
    await createContextItem(conn, {
      title: "B",
      contextPath: "/dir/b.md",
      content: "b",
    });
    await createContextItem(conn, {
      title: "Outside",
      contextPath: "/other.md",
      content: "c",
    });

    const count = await deleteContextItemsByPrefix(conn, "/dir");
    expect(count).toBe(2);
    expect(await contextPathExists(conn, "/other.md")).toBe(true);
  });
});

describe("search", () => {
  test("searchContextByKeyword finds by content", async () => {
    await createContextItem(conn, {
      title: "Meeting",
      contextPath: "/notes/meeting.md",
      content: "Discussed quarterly revenue targets",
    });
    await createContextItem(conn, {
      title: "Ideas",
      contextPath: "/notes/ideas.md",
      content: "Random brainstorm",
    });

    const results = await searchContextByKeyword(conn, "revenue");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Meeting");
  });

  test("searchContextByKeyword finds by title", async () => {
    await createContextItem(conn, {
      title: "Budget Report",
      contextPath: "/reports/budget.md",
      content: "Numbers here",
    });

    const results = await searchContextByKeyword(conn, "budget");
    expect(results.length).toBe(1);
  });

  test("searchContextByKeyword is case-insensitive", async () => {
    await createContextItem(conn, {
      title: "Test",
      contextPath: "/test.md",
      content: "Hello World",
    });

    const results = await searchContextByKeyword(conn, "hello world");
    expect(results.length).toBe(1);
  });
});
