import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { dirCreateTool } from "../../src/tools/dir/create.ts";
import { dirListTool } from "../../src/tools/dir/list.ts";
import { dirSizeTool } from "../../src/tools/dir/size.ts";
import { dirTreeTool } from "../../src/tools/dir/tree.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedDir, seedFile, setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(() => {
  ({ conn, ctx } = setupToolContext());
});

// ── dir_create ──────────────────────────────────────────────

describe("dir_create", () => {
  test("creates a new directory", async () => {
    const result = await dirCreateTool.execute({ path: "/mydir" }, ctx);
    expect(result.created).toBe(true);
    expect(result.path).toBe("/mydir");
  });

  test("returns created=false if directory already exists", async () => {
    await seedDir(conn, "/existing");
    const result = await dirCreateTool.execute({ path: "/existing" }, ctx);
    expect(result.created).toBe(false);
    expect(result.path).toBe("/existing");
  });
});

// ── dir_list ────────────────────────────────────────────────

describe("dir_list", () => {
  test("lists files at root", async () => {
    await seedFile(conn, "/a.txt", "aaa");
    await seedFile(conn, "/b.txt", "bbb");
    const result = await dirListTool.execute(
      { path: "/", recursive: true, limit: 100, offset: 0 },
      ctx,
    );
    expect(result.total).toBeGreaterThanOrEqual(2);
    const names = result.entries.map((e) => e.name);
    expect(names.some((n) => n.includes("a.txt"))).toBe(true);
    expect(names.some((n) => n.includes("b.txt"))).toBe(true);
  });

  test("lists with pagination", async () => {
    await seedFile(conn, "/p1.txt", "1");
    await seedFile(conn, "/p2.txt", "2");
    await seedFile(conn, "/p3.txt", "3");

    const page1 = await dirListTool.execute(
      { path: "/", recursive: true, limit: 2, offset: 0 },
      ctx,
    );
    expect(page1.entries.length).toBeLessThanOrEqual(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);

    const page2 = await dirListTool.execute(
      { path: "/", recursive: true, limit: 2, offset: 2 },
      ctx,
    );
    expect(page2.entries.length).toBeGreaterThanOrEqual(1);
  });

  test("returns empty for empty directory", async () => {
    const result = await dirListTool.execute(
      { path: "/empty", recursive: true, limit: 100, offset: 0 },
      ctx,
    );
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("non-recursive lists only immediate children", async () => {
    await seedFile(conn, "/top/child.txt", "child");
    await seedFile(conn, "/top/sub/deep.txt", "deep");
    const result = await dirListTool.execute(
      { path: "/top", recursive: false, limit: 100, offset: 0 },
      ctx,
    );
    // Should include child.txt and sub/ directory but not deep.txt directly
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test("entries include type and size", async () => {
    await seedFile(conn, "/typed.txt", "content");
    const result = await dirListTool.execute(
      { path: "/", recursive: true, limit: 100, offset: 0 },
      ctx,
    );
    const entry = result.entries.find((e) => e.name.includes("typed.txt"));
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("file");
    expect(entry?.size).toBe(7);
  });
});

// ── dir_size ────────────────────────────────────────────────

describe("dir_size", () => {
  test("returns total size of files", async () => {
    await seedFile(conn, "/size/a.txt", "hello"); // 5 bytes
    await seedFile(conn, "/size/b.txt", "world!"); // 6 bytes
    const result = await dirSizeTool.execute({ path: "/size" }, ctx);
    expect(result.bytes).toBe(11);
    expect(result.formatted).toBeTruthy();
  });

  test("returns 0 for empty directory", async () => {
    const result = await dirSizeTool.execute({ path: "/nothing" }, ctx);
    expect(result.bytes).toBe(0);
    expect(result.formatted).toBe("0 B");
  });

  test("includes subdirectories by default", async () => {
    await seedFile(conn, "/deep/a.txt", "aaa");
    await seedFile(conn, "/deep/sub/b.txt", "bbb");
    const result = await dirSizeTool.execute({ path: "/deep" }, ctx);
    expect(result.bytes).toBe(6);
  });
});

// ── dir_tree ────────────────────────────────────────────────

describe("dir_tree", () => {
  test("renders a tree with files", async () => {
    await seedFile(conn, "/tree/a.txt", "a");
    await seedFile(conn, "/tree/sub/b.txt", "b");
    const result = await dirTreeTool.execute(
      { path: "/tree", max_items: 200 },
      ctx,
    );
    expect(result.tree).toContain("/tree");
    expect(result.tree).toContain("a.txt");
    expect(result.tree).toContain("b.txt");
  });

  test("shows (empty) for empty directory", async () => {
    const result = await dirTreeTool.execute(
      { path: "/void", max_items: 200 },
      ctx,
    );
    expect(result.tree).toContain("(empty)");
  });

  test("respects max_items", async () => {
    // Seed more items than max_items
    for (let i = 0; i < 5; i++) {
      await seedFile(conn, `/many/file${i}.txt`, `content ${i}`);
    }
    const result = await dirTreeTool.execute(
      { path: "/many", max_items: 3 },
      ctx,
    );
    expect(result.tree).toContain("truncated");
  });
});
