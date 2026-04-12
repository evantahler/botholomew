import { describe, expect, test, beforeEach } from "bun:test";
import {
  getMemoryConnection,
  type DuckDBConnection,
} from "../../src/db/connection.ts";
import { migrate } from "../../src/db/schema.ts";
import {
  createContextItem,
  getContextItem,
  getContextItemByPath,
  listContextItems,
  listContextItemsByPrefix,
  contextPathExists,
  getDistinctDirectories,
  updateContextItem,
  updateContextItemContent,
  applyPatchesToContextItem,
  copyContextItem,
  moveContextItem,
  deleteContextItem,
  deleteContextItemByPath,
  deleteContextItemsByPrefix,
  searchContextByKeyword,
} from "../../src/db/context.ts";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await getMemoryConnection();
  await migrate(conn);
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
    expect(fetched!.title).toBe("Test");
  });

  test("get by path", async () => {
    await createContextItem(conn, {
      title: "Notes",
      content: "Some notes",
      contextPath: "/notes/meeting.md",
    });

    const item = await getContextItemByPath(conn, "/notes/meeting.md");
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Notes");

    const missing = await getContextItemByPath(conn, "/nonexistent");
    expect(missing).toBeNull();
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
    expect(jsonOnly[0]!.title).toBe("B");
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
    expect(updated!.title).toBe("New");
    expect(updated!.content).toBe("new content");
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
    expect(updated!.content).toBe("replaced");
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
    expect(moved!.content).toBe("content");
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
    expect(results[0]!.title).toBe("Meeting");
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
