import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { contextCreateDirTool } from "../../src/tools/dir/create.ts";
import { contextListDirTool } from "../../src/tools/dir/list.ts";
import { contextDirSizeTool } from "../../src/tools/dir/size.ts";
import { contextTreeTool } from "../../src/tools/dir/tree.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedDir, seedFile, setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

const D = "agent";

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

// ── context_create_dir ──────────────────────────────────────────

describe("context_create_dir", () => {
  test("creates a new directory", async () => {
    const result = await contextCreateDirTool.execute(
      { drive: D, path: "/mydir" },
      ctx,
    );
    expect(result.created).toBe(true);
    expect(result.ref).toBe(`${D}:/mydir`);
  });

  test("returns created=false if directory already exists", async () => {
    await seedDir(conn, "/existing");
    const result = await contextCreateDirTool.execute(
      { drive: D, path: "/existing" },
      ctx,
    );
    expect(result.created).toBe(false);
    expect(result.ref).toBe(`${D}:/existing`);
  });
});

// ── context_list_dir ────────────────────────────────────────────

describe("context_list_dir", () => {
  test("lists files at root", async () => {
    await seedFile(conn, "/a.txt", "aaa");
    await seedFile(conn, "/b.txt", "bbb");
    const result = await contextListDirTool.execute(
      { drive: D, path: "/", recursive: true, limit: 100, offset: 0 },
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

    const page1 = await contextListDirTool.execute(
      { drive: D, path: "/", recursive: true, limit: 2, offset: 0 },
      ctx,
    );
    expect(page1.entries.length).toBeLessThanOrEqual(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);

    const page2 = await contextListDirTool.execute(
      { drive: D, path: "/", recursive: true, limit: 2, offset: 2 },
      ctx,
    );
    expect(page2.entries.length).toBeGreaterThanOrEqual(1);
  });

  test("returns empty for empty directory", async () => {
    const result = await contextListDirTool.execute(
      { drive: D, path: "/empty", recursive: true, limit: 100, offset: 0 },
      ctx,
    );
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  test("non-recursive lists only immediate children", async () => {
    await seedFile(conn, "/top/child.txt", "child");
    await seedFile(conn, "/top/sub/deep.txt", "deep");
    const result = await contextListDirTool.execute(
      { drive: D, path: "/top", recursive: false, limit: 100, offset: 0 },
      ctx,
    );
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test("entries include type and size", async () => {
    await seedFile(conn, "/typed.txt", "content");
    const result = await contextListDirTool.execute(
      { drive: D, path: "/", recursive: true, limit: 100, offset: 0 },
      ctx,
    );
    const entry = result.entries.find((e) => e.name.includes("typed.txt"));
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("file");
    expect(entry?.size).toBe(7);
  });
});

// ── context_dir_size ────────────────────────────────────────────

describe("context_dir_size", () => {
  test("returns total size of files", async () => {
    await seedFile(conn, "/size/a.txt", "hello");
    await seedFile(conn, "/size/b.txt", "world!");
    const result = await contextDirSizeTool.execute(
      { drive: D, path: "/size" },
      ctx,
    );
    expect(result.bytes).toBe(11);
    expect(result.formatted).toBeTruthy();
  });

  test("returns 0 for empty directory", async () => {
    const result = await contextDirSizeTool.execute(
      { drive: D, path: "/nothing" },
      ctx,
    );
    expect(result.bytes).toBe(0);
    expect(result.formatted).toBe("0 B");
  });

  test("includes subdirectories by default", async () => {
    await seedFile(conn, "/deep/a.txt", "aaa");
    await seedFile(conn, "/deep/sub/b.txt", "bbb");
    const result = await contextDirSizeTool.execute(
      { drive: D, path: "/deep" },
      ctx,
    );
    expect(result.bytes).toBe(6);
  });
});

// ── context_tree ────────────────────────────────────────────────

describe("context_tree", () => {
  test("with no drive: lists drives with counts", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, { drive: "disk", path: "/tmp/b.txt" }, "b");
    const result = await contextTreeTool.execute(
      { max_depth: 3, items_per_dir: 15 },
      ctx,
    );
    expect(result.tree).toContain("agent:/");
    expect(result.tree).toContain("disk:/");
    expect(result.total_items).toBe(2);
  });

  test("renders a tree for a drive with files", async () => {
    await seedFile(conn, "/tree/a.txt", "a");
    await seedFile(conn, "/tree/sub/b.txt", "b");
    const result = await contextTreeTool.execute(
      { drive: D, path: "/tree", max_depth: 3, items_per_dir: 15 },
      ctx,
    );
    expect(result.tree).toContain(`${D}:/tree`);
    expect(result.tree).toContain("a.txt");
    expect(result.tree).toContain("b.txt");
    expect(result.total_items).toBe(2);
    expect(result.truncated_dirs).toEqual([]);
    expect(result.hint).toBe("Tree is complete.");
  });

  test("shows (empty) for empty directory", async () => {
    const result = await contextTreeTool.execute(
      { drive: D, path: "/void", max_depth: 3, items_per_dir: 15 },
      ctx,
    );
    expect(result.tree).toContain("(empty)");
    expect(result.total_items).toBe(0);
    expect(result.truncated_dirs).toEqual([]);
  });

  test("respects items_per_dir and reports overflow", async () => {
    for (let i = 0; i < 10; i++) {
      await seedFile(conn, `/many/file${i}.txt`, `content ${i}`);
    }
    const result = await contextTreeTool.execute(
      { drive: D, path: "/many", max_depth: 3, items_per_dir: 3 },
      ctx,
    );
    expect(result.tree).toContain("(+7 more)");
    expect(result.truncated_dirs).toHaveLength(1);
    expect(result.truncated_dirs[0]).toEqual({
      path: "/many",
      shown: 3,
      total: 10,
    });
    expect(result.hint).toContain("items_per_dir");
    expect(result.hint).toContain("/many");
  });

  test("respects max_depth and reports depth-limited dirs", async () => {
    await seedFile(conn, "/deep/a/b/c/file.txt", "deep");
    const result = await contextTreeTool.execute(
      { drive: D, path: "/deep", max_depth: 2, items_per_dir: 15 },
      ctx,
    );
    expect(result.tree).toContain("a/");
    expect(result.tree).toContain("b/");
    expect(result.tree).not.toContain("file.txt");
    expect(result.tree).toContain("drill in");
    expect(result.hint).toContain("max_depth");
  });

  test("total_items reflects recursive count", async () => {
    await seedFile(conn, "/count/a.txt", "a");
    await seedFile(conn, "/count/sub/b.txt", "b");
    await seedFile(conn, "/count/sub/c.txt", "c");
    const result = await contextTreeTool.execute(
      { drive: D, path: "/count", max_depth: 5, items_per_dir: 50 },
      ctx,
    );
    expect(result.total_items).toBe(3);
  });

  test("sorts directories before files", async () => {
    await seedFile(conn, "/order/zfile.txt", "z");
    await seedFile(conn, "/order/adir/x.txt", "x");
    const result = await contextTreeTool.execute(
      { drive: D, path: "/order", max_depth: 3, items_per_dir: 15 },
      ctx,
    );
    const adirIdx = result.tree.indexOf("adir/");
    const zfileIdx = result.tree.indexOf("zfile.txt");
    expect(adirIdx).toBeGreaterThan(-1);
    expect(zfileIdx).toBeGreaterThan(-1);
    expect(adirIdx).toBeLessThan(zfileIdx);
  });
});
