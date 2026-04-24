import { beforeEach, describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";
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
  getContextItemById,
  getDistinctDirectories,
  listContextItems,
  listContextItemsByPrefix,
  moveContextItem,
  PathConflictError,
  resolveContextItem,
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
      drive: "agent",
      path: "/docs/test.md",
    });
    expect(item.id).toBeTruthy();
    expect(item.title).toBe("Test");
    expect(item.content).toBe("Hello world");
    expect(item.drive).toBe("agent");
    expect(item.path).toBe("/docs/test.md");
    expect(item.mime_type).toBe("text/plain");

    const fetched = await getContextItemById(conn, item.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe("Test");
  });

  test("duplicate (drive, path) is rejected by unique index", async () => {
    await createContextItem(conn, {
      title: "First",
      content: "v1",
      drive: "agent",
      path: "/docs/test.md",
    });

    await expect(
      createContextItem(conn, {
        title: "Second",
        content: "v2",
        drive: "agent",
        path: "/docs/test.md",
      }),
    ).rejects.toThrow();

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
    expect(items[0]?.content).toBe("v1");
  });

  test("same path on different drives coexists", async () => {
    await createContextItem(conn, {
      title: "Disk README",
      content: "disk",
      drive: "disk",
      path: "/Users/x/README.md",
    });
    await createContextItem(conn, {
      title: "Agent README",
      content: "agent",
      drive: "agent",
      path: "/Users/x/README.md",
    });

    const items = await listContextItems(conn);
    expect(items.length).toBe(2);
  });

  test("upsert: adding same (drive, path) twice updates instead of duplicating", async () => {
    await createContextItem(conn, {
      title: "Original",
      content: "v1",
      drive: "agent",
      path: "/docs/test.md",
    });

    const existing = await getContextItem(conn, {
      drive: "agent",
      path: "/docs/test.md",
    });
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
      drive: "agent",
      path: "/strict/new.md",
    });
    expect(item.title).toBe("Strict");
    expect(item.content).toBe("hello");
    expect(item.path).toBe("/strict/new.md");
  });

  test("createContextItemStrict: throws PathConflictError on collision", async () => {
    const first = await createContextItemStrict(conn, {
      title: "Original",
      content: "v1",
      drive: "agent",
      path: "/strict/conflict.md",
    });

    let caught: unknown;
    try {
      await createContextItemStrict(conn, {
        title: "Second",
        content: "v2",
        drive: "agent",
        path: "/strict/conflict.md",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PathConflictError);
    if (caught instanceof PathConflictError) {
      expect(caught.existingId).toBe(first.id);
      expect(caught.drive).toBe("agent");
      expect(caught.path).toBe("/strict/conflict.md");
    }

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
    expect(items[0]?.content).toBe("v1");
  });

  test("upsertContextItem: insert when new", async () => {
    const item = await upsertContextItem(conn, {
      title: "New File",
      content: "hello",
      drive: "agent",
      path: "/docs/new.md",
    });
    expect(item.title).toBe("New File");
    expect(item.content).toBe("hello");
    expect(item.path).toBe("/docs/new.md");

    const items = await listContextItems(conn);
    expect(items.length).toBe(1);
  });

  test("upsertContextItem: update when exists", async () => {
    const original = await upsertContextItem(conn, {
      title: "V1",
      content: "first",
      drive: "agent",
      path: "/docs/test.md",
    });

    const updated = await upsertContextItem(conn, {
      title: "V2",
      content: "second",
      drive: "agent",
      path: "/docs/test.md",
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
      drive: "agent",
      path: "/docs/test.md",
    });

    const updated = await upsertContextItem(conn, {
      title: "V2",
      content: "second",
      drive: "agent",
      path: "/docs/test.md",
    });

    expect(updated.created_at.getTime()).toBe(original.created_at.getTime());
  });

  test("get by (drive, path)", async () => {
    await createContextItem(conn, {
      title: "Notes",
      content: "Some notes",
      drive: "agent",
      path: "/notes/meeting.md",
    });

    const item = await getContextItem(conn, {
      drive: "agent",
      path: "/notes/meeting.md",
    });
    expect(item).not.toBeNull();
    expect(item?.title).toBe("Notes");

    const missing = await getContextItem(conn, {
      drive: "agent",
      path: "/nonexistent",
    });
    expect(missing).toBeNull();

    // Different drive with same path misses.
    const wrongDrive = await getContextItem(conn, {
      drive: "disk",
      path: "/notes/meeting.md",
    });
    expect(wrongDrive).toBeNull();
  });

  test("resolveContextItem: by UUID, drive:/path, and bare disk path", async () => {
    const relFile = "fixtures/readme.md";
    const absFile = resolvePath(relFile);

    const file = await createContextItem(conn, {
      title: "Readme",
      content: "hi",
      drive: "disk",
      path: absFile,
    });
    const url = await createContextItem(conn, {
      title: "Example",
      content: "remote",
      drive: "url",
      path: "/https://example.com",
    });

    const byId = await resolveContextItem(conn, file.id);
    expect(byId?.id).toBe(file.id);

    const byRef = await resolveContextItem(conn, `disk:${absFile}`);
    expect(byRef?.id).toBe(file.id);

    const byRelativeSource = await resolveContextItem(conn, relFile);
    expect(byRelativeSource?.id).toBe(file.id);

    const byAbsoluteSource = await resolveContextItem(conn, absFile);
    expect(byAbsoluteSource?.id).toBe(file.id);

    const byUrlRef = await resolveContextItem(conn, "url:/https://example.com");
    expect(byUrlRef?.id).toBe(url.id);

    const miss = await resolveContextItem(conn, "nope/does-not-exist.md");
    expect(miss).toBeNull();
  });

  test("list with filters", async () => {
    await createContextItem(conn, {
      title: "A",
      drive: "agent",
      path: "/a.md",
      content: "a",
    });
    await createContextItem(conn, {
      title: "B",
      drive: "agent",
      path: "/b.json",
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

  test("list filtered by drive", async () => {
    await createContextItem(conn, {
      title: "A",
      drive: "agent",
      path: "/a.md",
      content: "a",
    });
    await createContextItem(conn, {
      title: "B",
      drive: "disk",
      path: "/tmp/b.md",
      content: "b",
    });

    const diskOnly = await listContextItems(conn, { drive: "disk" });
    expect(diskOnly.length).toBe(1);
    expect(diskOnly[0]?.title).toBe("B");
  });
});

describe("filesystem queries", () => {
  beforeEach(async () => {
    await createContextItem(conn, {
      title: "Root",
      drive: "agent",
      path: "/readme.md",
      content: "root",
    });
    await createContextItem(conn, {
      title: "Notes 1",
      drive: "agent",
      path: "/notes/meeting.md",
      content: "meeting notes",
    });
    await createContextItem(conn, {
      title: "Notes 2",
      drive: "agent",
      path: "/notes/ideas.md",
      content: "ideas",
    });
    await createContextItem(conn, {
      title: "Deep",
      drive: "agent",
      path: "/notes/archive/old.md",
      content: "old stuff",
    });
  });

  test("listByPrefix non-recursive", async () => {
    const items = await listContextItemsByPrefix(conn, "agent", "/notes");
    expect(items.length).toBe(2);
    expect(items.map((i) => i.path).sort()).toEqual([
      "/notes/ideas.md",
      "/notes/meeting.md",
    ]);
  });

  test("listByPrefix recursive", async () => {
    const items = await listContextItemsByPrefix(conn, "agent", "/notes", {
      recursive: true,
    });
    expect(items.length).toBe(3);
  });

  test("listByPrefix is drive-scoped", async () => {
    const items = await listContextItemsByPrefix(conn, "disk", "/notes");
    expect(items.length).toBe(0);
  });

  test("contextPathExists", async () => {
    expect(
      await contextPathExists(conn, {
        drive: "agent",
        path: "/notes/meeting.md",
      }),
    ).toBe(true);
    expect(
      await contextPathExists(conn, { drive: "agent", path: "/nonexistent" }),
    ).toBe(false);
  });

  test("getDistinctDirectories", async () => {
    const dirs = await getDistinctDirectories(conn, "agent", "/notes");
    expect(dirs).toEqual(["/notes/archive"]);
  });
});

describe("mutations", () => {
  test("updateContextItem", async () => {
    const item = await createContextItem(conn, {
      title: "Old",
      drive: "agent",
      path: "/test.md",
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
      drive: "agent",
      path: "/test.md",
      content: "original",
    });

    const updated = await updateContextItemContent(
      conn,
      { drive: "agent", path: "/test.md" },
      "replaced",
    );
    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("replaced");
  });

  test("applyPatches — replace lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "line1\nline2\nline3\nline4",
    });

    const { item, applied } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/test.md" },
      [{ start_line: 2, end_line: 3, content: "replaced" }],
    );

    expect(applied).toBe(1);
    expect(item.content).toBe("line1\nreplaced\nline4");
  });

  test("applyPatches — delete lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "line1\nline2\nline3",
    });

    const { item } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/test.md" },
      [{ start_line: 2, end_line: 2, content: "" }],
    );

    expect(item.content).toBe("line1\nline3");
  });

  test("applyPatches — insert lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "line1\nline2",
    });

    const { item } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/test.md" },
      [{ start_line: 2, end_line: 0, content: "inserted" }],
    );

    expect(item.content).toBe("line1\ninserted\nline2");
  });

  test("applyPatches — multiple patches applied bottom-up", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "a\nb\nc\nd\ne",
    });

    const { item } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/test.md" },
      [
        { start_line: 2, end_line: 2, content: "B" },
        { start_line: 4, end_line: 4, content: "D" },
      ],
    );

    expect(item.content).toBe("a\nB\nc\nD\ne");
  });

  test("applyPatches — throws for nonexistent item", async () => {
    await expect(
      applyPatchesToContextItem(
        conn,
        { drive: "agent", path: "/does-not-exist.md" },
        [{ start_line: 1, end_line: 1, content: "x" }],
      ),
    ).rejects.toThrow("Not found");
  });

  test("applyPatches — throws for null content", async () => {
    await createContextItem(conn, {
      title: "Binary",
      drive: "agent",
      path: "/binary.bin",
      isTextual: false,
    });

    await expect(
      applyPatchesToContextItem(conn, { drive: "agent", path: "/binary.bin" }, [
        { start_line: 1, end_line: 1, content: "x" },
      ]),
    ).rejects.toThrow("No text content");
  });

  test("applyPatches — out-of-bounds start_line extends content", async () => {
    await createContextItem(conn, {
      title: "Short",
      drive: "agent",
      path: "/short.md",
      content: "only-one-line",
    });

    const { item } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/short.md" },
      [{ start_line: 5, end_line: 0, content: "appended" }],
    );

    expect(item.content).toContain("only-one-line");
    expect(item.content).toContain("appended");
  });

  test("applyPatches — replace single line with multiple lines", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "a\nb\nc",
    });

    const { item } = await applyPatchesToContextItem(
      conn,
      { drive: "agent", path: "/test.md" },
      [{ start_line: 2, end_line: 2, content: "x\ny\nz" }],
    );

    expect(item.content).toBe("a\nx\ny\nz\nc");
  });

  test("copyContextItem", async () => {
    await createContextItem(conn, {
      title: "Original",
      drive: "agent",
      path: "/src.md",
      content: "content",
    });

    const copy = await copyContextItem(
      conn,
      { drive: "agent", path: "/src.md" },
      { drive: "agent", path: "/dst.md" },
    );
    expect(copy.path).toBe("/dst.md");
    expect(copy.content).toBe("content");
    expect(copy.title).toBe("Original");

    const original = await getContextItem(conn, {
      drive: "agent",
      path: "/src.md",
    });
    expect(original).not.toBeNull();
  });

  test("moveContextItem", async () => {
    await createContextItem(conn, {
      title: "Moving",
      drive: "agent",
      path: "/old.md",
      content: "content",
    });

    await moveContextItem(
      conn,
      { drive: "agent", path: "/old.md" },
      { drive: "agent", path: "/new.md" },
    );

    expect(
      await getContextItem(conn, { drive: "agent", path: "/old.md" }),
    ).toBeNull();
    const moved = await getContextItem(conn, {
      drive: "agent",
      path: "/new.md",
    });
    expect(moved).not.toBeNull();
    expect(moved?.content).toBe("content");
  });
});

describe("deletion", () => {
  test("deleteContextItem by id", async () => {
    const item = await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "x",
    });

    const deleted = await deleteContextItem(conn, item.id);
    expect(deleted).toBe(true);
    expect(await getContextItemById(conn, item.id)).toBeNull();
  });

  test("deleteContextItemByPath", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "x",
    });

    const deleted = await deleteContextItemByPath(conn, {
      drive: "agent",
      path: "/test.md",
    });
    expect(deleted).toBe(true);
    expect(
      await getContextItem(conn, { drive: "agent", path: "/test.md" }),
    ).toBeNull();
  });

  test("deleteContextItemsByPrefix", async () => {
    await createContextItem(conn, {
      title: "A",
      drive: "agent",
      path: "/dir/a.md",
      content: "a",
    });
    await createContextItem(conn, {
      title: "B",
      drive: "agent",
      path: "/dir/b.md",
      content: "b",
    });
    await createContextItem(conn, {
      title: "Outside",
      drive: "agent",
      path: "/other.md",
      content: "c",
    });

    const count = await deleteContextItemsByPrefix(conn, "agent", "/dir");
    expect(count).toBe(2);
    expect(
      await contextPathExists(conn, { drive: "agent", path: "/other.md" }),
    ).toBe(true);
  });
});

describe("search", () => {
  test("searchContextByKeyword finds by content", async () => {
    await createContextItem(conn, {
      title: "Meeting",
      drive: "agent",
      path: "/notes/meeting.md",
      content: "Discussed quarterly revenue targets",
    });
    await createContextItem(conn, {
      title: "Ideas",
      drive: "agent",
      path: "/notes/ideas.md",
      content: "Random brainstorm",
    });

    const results = await searchContextByKeyword(conn, "revenue");
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Meeting");
  });

  test("searchContextByKeyword finds by title", async () => {
    await createContextItem(conn, {
      title: "Budget Report",
      drive: "agent",
      path: "/reports/budget.md",
      content: "Numbers here",
    });

    const results = await searchContextByKeyword(conn, "budget");
    expect(results.length).toBe(1);
  });

  test("searchContextByKeyword is case-insensitive", async () => {
    await createContextItem(conn, {
      title: "Test",
      drive: "agent",
      path: "/test.md",
      content: "Hello World",
    });

    const results = await searchContextByKeyword(conn, "hello world");
    expect(results.length).toBe(1);
  });
});
