/**
 * Behavioral coverage for src/context/store.ts. The sandbox-security side is
 * covered by test/fs/sandbox.test.ts and test/tools/file-sandbox.test.ts;
 * this file covers the *positive* behaviors: read/write/edit/move/copy/
 * delete/info/exists/listDir/buildTree/dirSize/applyPatches semantics on
 * legitimate paths inside `context/`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_DIR } from "../../src/constants.ts";
import {
  applyPatches,
  buildTree,
  copyContextPath,
  createContextDir,
  deleteContextPath,
  dirSizeBytes,
  fileExists,
  getInfo,
  IsDirectoryError,
  listContextDir,
  moveContextPath,
  NotDirectoryError,
  NotFoundError,
  PathConflictError,
  readContextFile,
  relativeFromContext,
  writeContextFile,
} from "../../src/context/store.ts";
import { _resetSandboxCacheForTests } from "../../src/fs/sandbox.ts";

let projectDir: string;

beforeEach(async () => {
  _resetSandboxCacheForTests();
  projectDir = await mkdtemp(join(tmpdir(), "both-context-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
});

afterEach(async () => {
  _resetSandboxCacheForTests();
  await rm(projectDir, { recursive: true, force: true });
});

async function seed(path: string, content: string): Promise<void> {
  const abs = join(projectDir, CONTEXT_DIR, path);
  const { dirname } = await import("node:path");
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

describe("read / write / info / exists", () => {
  test("writeContextFile creates a file and returns its info", async () => {
    const entry = await writeContextFile(projectDir, "notes/foo.md", "hi");
    expect(entry.path).toBe("notes/foo.md");
    expect(entry.is_directory).toBe(false);
    expect(entry.size).toBe(2);
    expect(entry.is_textual).toBe(true);
    expect(entry.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("readContextFile reads back the same content", async () => {
    await writeContextFile(projectDir, "x.md", "hello\nworld");
    expect(await readContextFile(projectDir, "x.md")).toBe("hello\nworld");
  });

  test("readContextFile throws NotFoundError for missing files", async () => {
    await expect(readContextFile(projectDir, "no.md")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("readContextFile throws IsDirectoryError when target is a dir", async () => {
    await createContextDir(projectDir, "sub");
    await expect(readContextFile(projectDir, "sub")).rejects.toBeInstanceOf(
      IsDirectoryError,
    );
  });

  test("writeContextFile honors on_conflict='error'", async () => {
    await writeContextFile(projectDir, "x.md", "v1");
    await expect(
      writeContextFile(projectDir, "x.md", "v2", { onConflict: "error" }),
    ).rejects.toBeInstanceOf(PathConflictError);
    expect(await readContextFile(projectDir, "x.md")).toBe("v1");
  });

  test("writeContextFile defaults to overwrite", async () => {
    await writeContextFile(projectDir, "x.md", "v1");
    await writeContextFile(projectDir, "x.md", "v2");
    expect(await readContextFile(projectDir, "x.md")).toBe("v2");
  });

  test("writeContextFile rejects directory-shaped paths", async () => {
    await expect(writeContextFile(projectDir, "", "x")).rejects.toThrow();
    await expect(writeContextFile(projectDir, "dir/", "x")).rejects.toThrow();
  });

  test("getInfo returns null for missing paths", async () => {
    expect(await getInfo(projectDir, "no.md")).toBeNull();
  });

  test("getInfo describes directories distinctly", async () => {
    await createContextDir(projectDir, "sub/nested");
    const info = await getInfo(projectDir, "sub");
    expect(info?.is_directory).toBe(true);
    expect(info?.mime_type).toBe("inode/directory");
    expect(info?.content_hash).toBeNull();
  });

  test("getInfo content_hash matches sha256 of file bytes", async () => {
    await writeContextFile(projectDir, "x.md", "stable");
    const a = (await getInfo(projectDir, "x.md"))?.content_hash;
    await writeContextFile(projectDir, "x.md", "stable");
    const b = (await getInfo(projectDir, "x.md"))?.content_hash;
    expect(a).toBe(b);
    await writeContextFile(projectDir, "x.md", "different");
    const c = (await getInfo(projectDir, "x.md"))?.content_hash;
    expect(c).not.toBe(a);
  });

  test("fileExists returns true/false correctly", async () => {
    await seed("x.md", "x");
    expect(await fileExists(projectDir, "x.md")).toBe(true);
    expect(await fileExists(projectDir, "missing.md")).toBe(false);
  });
});

describe("delete", () => {
  test("deleteContextPath removes a file", async () => {
    await seed("x.md", "x");
    const r = await deleteContextPath(projectDir, "x.md");
    expect(r.was_directory).toBe(false);
    expect(r.removed).toBe(1);
    expect(await fileExists(projectDir, "x.md")).toBe(false);
  });

  test("deleteContextPath throws NotFoundError on missing file", async () => {
    await expect(deleteContextPath(projectDir, "no.md")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("deleteContextPath throws IsDirectoryError when called on a dir without recursive", async () => {
    await seed("sub/a.md", "a");
    await expect(deleteContextPath(projectDir, "sub")).rejects.toBeInstanceOf(
      IsDirectoryError,
    );
  });

  test("deleteContextPath with recursive removes the whole subtree and counts files", async () => {
    await seed("sub/a.md", "a");
    await seed("sub/b/c.md", "c");
    const r = await deleteContextPath(projectDir, "sub", { recursive: true });
    expect(r.was_directory).toBe(true);
    expect(r.removed).toBe(2);
    expect(await fileExists(projectDir, "sub")).toBe(false);
  });

  test("deleteContextPath refuses to delete the context root", async () => {
    await expect(
      deleteContextPath(projectDir, "", { recursive: true }),
    ).rejects.toThrow();
  });
});

describe("move / copy", () => {
  test("moveContextPath renames a file", async () => {
    await seed("a.md", "x");
    await moveContextPath(projectDir, "a.md", "b.md");
    expect(await fileExists(projectDir, "a.md")).toBe(false);
    expect(await readContextFile(projectDir, "b.md")).toBe("x");
  });

  test("moveContextPath creates intermediate directories on dst", async () => {
    await seed("a.md", "x");
    await moveContextPath(projectDir, "a.md", "deep/nested/b.md");
    expect(await readContextFile(projectDir, "deep/nested/b.md")).toBe("x");
  });

  test("moveContextPath throws NotFoundError when src is missing", async () => {
    await expect(
      moveContextPath(projectDir, "missing.md", "b.md"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("moveContextPath refuses to clobber an existing dst", async () => {
    await seed("a.md", "x");
    await seed("b.md", "y");
    await expect(
      moveContextPath(projectDir, "a.md", "b.md"),
    ).rejects.toBeInstanceOf(PathConflictError);
  });

  test("copyContextPath duplicates a file's contents", async () => {
    await seed("a.md", "x");
    await copyContextPath(projectDir, "a.md", "b.md");
    expect(await readContextFile(projectDir, "a.md")).toBe("x");
    expect(await readContextFile(projectDir, "b.md")).toBe("x");
  });

  test("copyContextPath refuses to copy a directory", async () => {
    await createContextDir(projectDir, "sub");
    await expect(
      copyContextPath(projectDir, "sub", "sub2"),
    ).rejects.toBeInstanceOf(IsDirectoryError);
  });

  test("copyContextPath refuses to overwrite an existing dst", async () => {
    await seed("a.md", "x");
    await seed("b.md", "y");
    await expect(
      copyContextPath(projectDir, "a.md", "b.md"),
    ).rejects.toBeInstanceOf(PathConflictError);
  });
});

describe("listContextDir / buildTree / dirSizeBytes", () => {
  test("listContextDir returns immediate children when non-recursive", async () => {
    await seed("a.md", "1");
    await seed("sub/b.md", "2");
    const top = await listContextDir(projectDir, "");
    const paths = top.map((e) => e.path).sort();
    expect(paths).toEqual(["a.md", "sub"]);
  });

  test("listContextDir recursive includes nested entries", async () => {
    await seed("a.md", "1");
    await seed("sub/b.md", "2");
    const all = await listContextDir(projectDir, "", { recursive: true });
    const paths = all.map((e) => e.path).sort();
    expect(paths).toEqual(["a.md", "sub", "sub/b.md"]);
  });

  test("listContextDir throws NotDirectoryError on a file", async () => {
    await seed("a.md", "1");
    await expect(listContextDir(projectDir, "a.md")).rejects.toBeInstanceOf(
      NotDirectoryError,
    );
  });

  test("listContextDir throws NotFoundError on missing path", async () => {
    await expect(listContextDir(projectDir, "no/such")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("listContextDir hides dotfiles", async () => {
    await seed("a.md", "1");
    await seed(".hidden", "x");
    const top = await listContextDir(projectDir, "");
    expect(top.map((e) => e.path)).toEqual(["a.md"]);
  });

  test("buildTree returns a recursive tree node", async () => {
    await seed("a.md", "1");
    await seed("sub/b.md", "2");
    await seed("sub/nested/c.md", "3");
    const root = await buildTree(projectDir, "");
    expect(root.is_directory).toBe(true);
    expect(root.children?.length).toBe(2);
    const sub = root.children?.find((c) => c.name === "sub");
    expect(sub?.children?.length).toBe(2);
  });

  test("buildTree honors maxDepth", async () => {
    await seed("a/b/c/d.md", "x");
    const shallow = await buildTree(projectDir, "", 1);
    const a = shallow.children?.find((c) => c.name === "a");
    expect(a?.children).toEqual([]);
  });

  test("dirSizeBytes sums byte sizes recursively", async () => {
    await seed("a.md", "12345"); // 5 bytes
    await seed("sub/b.md", "67890ABC"); // 8 bytes
    const r = await dirSizeBytes(projectDir, "");
    expect(r.files).toBe(2);
    expect(r.bytes).toBe(13);
  });

  test("dirSizeBytes throws NotDirectoryError on a file", async () => {
    await seed("a.md", "x");
    await expect(dirSizeBytes(projectDir, "a.md")).rejects.toBeInstanceOf(
      NotDirectoryError,
    );
  });
});

describe("createContextDir", () => {
  test("creates intermediate directories", async () => {
    await createContextDir(projectDir, "deep/nested/dir");
    const info = await getInfo(projectDir, "deep/nested/dir");
    expect(info?.is_directory).toBe(true);
  });
});

describe("applyPatches", () => {
  test("replaces a single line in place", async () => {
    await seed("x.md", "a\nb\nc");
    const r = await applyPatches(projectDir, "x.md", [
      { start_line: 2, end_line: 2, content: "B" },
    ]);
    expect(r.applied).toBe(1);
    expect(await readContextFile(projectDir, "x.md")).toBe("a\nB\nc");
  });

  test("inserts without replacing when end_line is 0", async () => {
    await seed("x.md", "a\nb\nc");
    await applyPatches(projectDir, "x.md", [
      { start_line: 2, end_line: 0, content: "X" },
    ]);
    expect(await readContextFile(projectDir, "x.md")).toBe("a\nX\nb\nc");
  });

  test("deletes a line range when content is empty", async () => {
    await seed("x.md", "a\nb\nc\nd");
    await applyPatches(projectDir, "x.md", [
      { start_line: 2, end_line: 3, content: "" },
    ]);
    expect(await readContextFile(projectDir, "x.md")).toBe("a\nd");
  });

  test("applies multiple patches bottom-up so earlier line numbers stay stable", async () => {
    await seed("x.md", "a\nb\nc\nd\ne");
    await applyPatches(projectDir, "x.md", [
      { start_line: 1, end_line: 1, content: "A" },
      { start_line: 5, end_line: 5, content: "E" },
    ]);
    expect(await readContextFile(projectDir, "x.md")).toBe("A\nb\nc\nd\nE");
  });

  test("replaces a single line with multiple lines", async () => {
    await seed("x.md", "a\nb\nc");
    await applyPatches(projectDir, "x.md", [
      { start_line: 2, end_line: 2, content: "B1\nB2\nB3" },
    ]);
    expect(await readContextFile(projectDir, "x.md")).toBe("a\nB1\nB2\nB3\nc");
  });

  test("out-of-bounds start_line appends rather than throwing", async () => {
    // splice(index >= length) inserts at the end; this lets the agent append
    // safely without first reading the file's line count.
    await seed("x.md", "a\nb");
    await applyPatches(projectDir, "x.md", [
      { start_line: 99, end_line: 0, content: "Z" },
    ]);
    const after = await readContextFile(projectDir, "x.md");
    expect(after.endsWith("Z")).toBe(true);
  });

  test("throws NotFoundError when the file doesn't exist", async () => {
    await expect(
      applyPatches(projectDir, "no-such-file.md", [
        { start_line: 1, end_line: 1, content: "x" },
      ]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("relativeFromContext", () => {
  test("strips the canonical context prefix and returns a forward-slash path", async () => {
    await seed("notes/x.md", "x");
    const info = await getInfo(projectDir, "notes/x.md");
    if (!info) throw new Error("missing");
    // info.path is already context-relative; round-trip through abs.
    const { realpathSync } = await import("node:fs");
    const abs = join(realpathSync(projectDir), CONTEXT_DIR, "notes", "x.md");
    expect(relativeFromContext(projectDir, abs)).toBe("notes/x.md");
  });
});
