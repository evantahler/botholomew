import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_DIR, getDbPath } from "../../src/constants.ts";
import { reindexContext } from "../../src/context/reindex.ts";
import { withDb } from "../../src/db/connection.ts";
import {
  getIndexedPath,
  indexStats,
  listIndexedPaths,
} from "../../src/db/embeddings.ts";
import { migrate } from "../../src/db/schema.ts";
import { fakeEmbed, TEST_CONFIG } from "../helpers.ts";

let projectDir: string;
let dbPath: string;

const fakeEmbedFn = async (texts: string[]) => texts.map(fakeEmbed);

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-reindex-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
  dbPath = getDbPath(projectDir);
  await withDb(dbPath, migrate);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("reindexContext", () => {
  test("indexes new files and reports counts", async () => {
    await writeFile(
      join(projectDir, CONTEXT_DIR, "notes.md"),
      "the revenue forecast looks healthy",
    );
    await writeFile(
      join(projectDir, CONTEXT_DIR, "k8s.md"),
      "kubernetes helm deployment notes",
    );
    const summary = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(summary.added).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.chunksWritten).toBeGreaterThanOrEqual(2);

    const stats = await withDb(dbPath, indexStats);
    expect(stats.paths).toBe(2);
    expect(stats.embedded).toBe(stats.chunks);
  });

  test("skips unchanged files on a second run", async () => {
    await writeFile(
      join(projectDir, CONTEXT_DIR, "notes.md"),
      "stable contents",
    );
    const first = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(first.added).toBe(1);

    const second = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.removed).toBe(0);
  });

  test("re-embeds when content changes", async () => {
    const path = join(projectDir, CONTEXT_DIR, "notes.md");
    await writeFile(path, "first version");
    await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    const before = await withDb(dbPath, (conn) =>
      getIndexedPath(conn, "notes.md"),
    );

    await writeFile(path, "second version with different bytes");
    const summary = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(0);

    const after = await withDb(dbPath, (conn) =>
      getIndexedPath(conn, "notes.md"),
    );
    expect(after?.content_hash).not.toBe(before?.content_hash);
  });

  test("removes index rows for files deleted on disk", async () => {
    const path = join(projectDir, CONTEXT_DIR, "doomed.md");
    await writeFile(path, "transient content");
    await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    const beforeRows = await withDb(dbPath, listIndexedPaths);
    expect(beforeRows.some((r) => r.path === "doomed.md")).toBe(true);

    await rm(path);
    const summary = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(summary.removed).toBe(1);

    const afterRows = await withDb(dbPath, listIndexedPaths);
    expect(afterRows.some((r) => r.path === "doomed.md")).toBe(false);
  });

  test("indexes content reachable through user-placed symlinks", async () => {
    // Seed external content outside the context tree, then symlink it in.
    const externalDir = await mkdtemp(join(tmpdir(), "both-reindex-ext-"));
    try {
      await writeFile(join(externalDir, "ext.md"), "shared knowledge");
      await mkdir(join(externalDir, "sub"), { recursive: true });
      await writeFile(
        join(externalDir, "sub", "deep.md"),
        "buried in a symlinked subtree",
      );

      await symlink(
        join(externalDir, "ext.md"),
        join(projectDir, CONTEXT_DIR, "ref.md"),
      );
      await symlink(
        join(externalDir, "sub"),
        join(projectDir, CONTEXT_DIR, "linked"),
      );

      const summary = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
        embedFn: fakeEmbedFn,
      });
      expect(summary.added).toBe(2);

      const rows = await withDb(dbPath, listIndexedPaths);
      const paths = rows.map((r) => r.path).sort();
      // The index stores the user-visible (symlink) path, not the resolved
      // target — a symlinked file at `ref.md` indexes as `ref.md`, and a
      // symlinked directory's children appear under the link's path.
      expect(paths).toEqual(["linked/deep.md", "ref.md"]);
    } finally {
      await rm(externalDir, { recursive: true, force: true });
    }
  });

  test("ignores binary files", async () => {
    await writeFile(
      join(projectDir, CONTEXT_DIR, "image.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const summary = await reindexContext(projectDir, TEST_CONFIG, dbPath, {
      embedFn: fakeEmbedFn,
    });
    expect(summary.added).toBe(0);
    expect(summary.chunksWritten).toBe(0);
  });
});
