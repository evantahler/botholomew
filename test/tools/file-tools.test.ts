/**
 * Per-tool happy-path coverage for the 12 file/dir tools. Sandbox/security
 * is exercised by test/tools/file-sandbox.test.ts; raw store semantics are
 * exercised by test/context/store.test.ts. This file verifies the tool
 * adapter layer: input shape, output shape, error_type strings,
 * next_action_hint formatting.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { CONTEXT_DIR } from "../../src/constants.ts";
import { _resetSandboxCacheForTests } from "../../src/fs/sandbox.ts";
import { contextCreateDirTool } from "../../src/tools/dir/create.ts";
import { contextDirSizeTool } from "../../src/tools/dir/size.ts";
import { contextTreeTool } from "../../src/tools/dir/tree.ts";
import { contextCopyTool } from "../../src/tools/file/copy.ts";
import { contextCountLinesTool } from "../../src/tools/file/count-lines.ts";
import { contextDeleteTool } from "../../src/tools/file/delete.ts";
import { contextEditTool } from "../../src/tools/file/edit.ts";
import { contextExistsTool } from "../../src/tools/file/exists.ts";
import { contextInfoTool } from "../../src/tools/file/info.ts";
import { contextMoveTool } from "../../src/tools/file/move.ts";
import { contextReadTool } from "../../src/tools/file/read.ts";
import { contextWriteTool } from "../../src/tools/file/write.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

let projectDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  _resetSandboxCacheForTests();
  projectDir = await mkdtemp(join(tmpdir(), "both-file-tools-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });
  ctx = {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
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

// ── context_write ──────────────────────────────────────────

describe("context_write", () => {
  test("creates a new file under context/", async () => {
    const r = await contextWriteTool.execute(
      { path: "notes/x.md", content: "hi" },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.path).toBe("notes/x.md");
  });

  test("returns path_conflict by default when the file exists", async () => {
    await seed("x.md", "old");
    const r = await contextWriteTool.execute(
      { path: "x.md", content: "new" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("path_conflict");
    expect(r.next_action_hint).toContain("on_conflict='overwrite'");
  });

  test("overwrites existing file when on_conflict='overwrite'", async () => {
    await seed("x.md", "old");
    const r = await contextWriteTool.execute(
      { path: "x.md", content: "new", on_conflict: "overwrite" },
      ctx,
    );
    expect(r.is_error).toBe(false);
    const back = await contextReadTool.execute({ path: "x.md" }, ctx);
    expect(back.content).toBe("new");
  });
});

// ── context_read ──────────────────────────────────────────

describe("context_read", () => {
  test("reads a file's contents", async () => {
    await seed("x.md", "hello\nworld");
    const r = await contextReadTool.execute({ path: "x.md" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.content).toBe("hello\nworld");
  });

  test("respects offset and limit (1-based, line-sliced)", async () => {
    await seed("x.md", "a\nb\nc\nd\ne");
    const r = await contextReadTool.execute(
      { path: "x.md", offset: 2, limit: 2 },
      ctx,
    );
    expect(r.content).toBe("b\nc");
  });

  test("returns not_found with a recovery hint", async () => {
    const r = await contextReadTool.execute({ path: "missing.md" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
    expect(r.message).toContain("missing.md");
    expect(r.next_action_hint).toContain("context_tree");
  });

  test("returns is_directory when target is a dir", async () => {
    await contextCreateDirTool.execute({ path: "sub" }, ctx);
    const r = await contextReadTool.execute({ path: "sub" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("is_directory");
  });
});

// ── context_edit ──────────────────────────────────────────

describe("context_edit", () => {
  test("replaces a single line", async () => {
    await seed("x.md", "a\nb\nc");
    const r = await contextEditTool.execute(
      {
        path: "x.md",
        patches: [{ start_line: 2, end_line: 2, content: "B" }],
      },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.applied).toBe(1);
    expect(r.content).toBe("a\nB\nc");
  });

  test("inserts when end_line=0", async () => {
    await seed("x.md", "a\nb");
    const r = await contextEditTool.execute(
      {
        path: "x.md",
        patches: [{ start_line: 1, end_line: 0, content: "X" }],
      },
      ctx,
    );
    expect(r.content).toBe("X\na\nb");
  });

  test("deletes when content is empty", async () => {
    await seed("x.md", "a\nb\nc");
    const r = await contextEditTool.execute(
      {
        path: "x.md",
        patches: [{ start_line: 2, end_line: 2, content: "" }],
      },
      ctx,
    );
    expect(r.content).toBe("a\nc");
  });

  test("returns not_found for missing files", async () => {
    const r = await contextEditTool.execute(
      {
        path: "no.md",
        patches: [{ start_line: 1, end_line: 1, content: "x" }],
      },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});

// ── context_delete ──────────────────────────────────────────

describe("context_delete", () => {
  test("deletes an existing file", async () => {
    await seed("x.md", "x");
    const r = await contextDeleteTool.execute({ path: "x.md" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.deleted).toBe(1);
    expect(r.was_directory).toBe(false);
  });

  test("returns not_found by default", async () => {
    const r = await contextDeleteTool.execute({ path: "no.md" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });

  test("force suppresses not_found error", async () => {
    const r = await contextDeleteTool.execute(
      { path: "no.md", force: true },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.deleted).toBe(0);
  });

  test("rejects directories without recursive flag, hints at recursive=true", async () => {
    await seed("sub/a.md", "a");
    const r = await contextDeleteTool.execute({ path: "sub" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("is_directory");
    expect(r.next_action_hint).toContain("recursive=true");
  });

  test("recursive removes a directory tree", async () => {
    await seed("sub/a.md", "a");
    await seed("sub/b/c.md", "c");
    const r = await contextDeleteTool.execute(
      { path: "sub", recursive: true },
      ctx,
    );
    expect(r.is_error).toBe(false);
    expect(r.was_directory).toBe(true);
    expect(r.deleted).toBe(2);
  });
});

// ── context_move ──────────────────────────────────────────

describe("context_move", () => {
  test("renames a file", async () => {
    await seed("a.md", "x");
    const r = await contextMoveTool.execute({ src: "a.md", dst: "b.md" }, ctx);
    expect(r.is_error).toBe(false);
    const back = await contextReadTool.execute({ path: "b.md" }, ctx);
    expect(back.content).toBe("x");
  });

  test("returns not_found when src is missing", async () => {
    const r = await contextMoveTool.execute(
      { src: "missing.md", dst: "b.md" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });

  test("returns path_conflict when dst exists", async () => {
    await seed("a.md", "x");
    await seed("b.md", "y");
    const r = await contextMoveTool.execute({ src: "a.md", dst: "b.md" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("path_conflict");
  });

  test("overwrite=true clears the destination first", async () => {
    await seed("a.md", "x");
    await seed("b.md", "y");
    const r = await contextMoveTool.execute(
      { src: "a.md", dst: "b.md", overwrite: true },
      ctx,
    );
    expect(r.is_error).toBe(false);
    const back = await contextReadTool.execute({ path: "b.md" }, ctx);
    expect(back.content).toBe("x");
  });
});

// ── context_copy ──────────────────────────────────────────

describe("context_copy", () => {
  test("copies a file to a new path", async () => {
    await seed("a.md", "x");
    const r = await contextCopyTool.execute({ src: "a.md", dst: "b.md" }, ctx);
    expect(r.is_error).toBe(false);
    expect((await contextReadTool.execute({ path: "a.md" }, ctx)).content).toBe(
      "x",
    );
    expect((await contextReadTool.execute({ path: "b.md" }, ctx)).content).toBe(
      "x",
    );
  });

  test("returns not_found when src is missing", async () => {
    const r = await contextCopyTool.execute(
      { src: "missing.md", dst: "b.md" },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});

// ── context_info ──────────────────────────────────────────

describe("context_info", () => {
  test("returns metadata for a real file", async () => {
    await seed("x.md", "abc");
    const r = await contextInfoTool.execute({ path: "x.md" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.file?.path).toBe("x.md");
    expect(r.file?.size).toBe(3);
    expect(r.file?.is_directory).toBe(false);
  });

  test("returns not_found for missing paths", async () => {
    const r = await contextInfoTool.execute({ path: "no.md" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});

// ── context_exists ──────────────────────────────────────────

describe("context_exists", () => {
  test("returns true for existing files", async () => {
    await seed("x.md", "x");
    const r = await contextExistsTool.execute({ path: "x.md" }, ctx);
    expect(r.exists).toBe(true);
  });

  test("returns false for missing files", async () => {
    const r = await contextExistsTool.execute({ path: "no.md" }, ctx);
    expect(r.exists).toBe(false);
  });
});

// ── context_count_lines ──────────────────────────────────────

describe("context_count_lines", () => {
  test("counts newlines in a file", async () => {
    await seed("x.md", "a\nb\nc\n");
    const r = await contextCountLinesTool.execute({ path: "x.md" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.lines).toBeGreaterThanOrEqual(3);
  });

  test("returns not_found for missing files", async () => {
    const r = await contextCountLinesTool.execute({ path: "no.md" }, ctx);
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});

// ── context_create_dir ──────────────────────────────────────

describe("context_create_dir", () => {
  test("creates a new directory", async () => {
    const r = await contextCreateDirTool.execute({ path: "deep/nested" }, ctx);
    expect(r.is_error).toBe(false);
    const info = await contextInfoTool.execute({ path: "deep/nested" }, ctx);
    expect(info.file?.is_directory).toBe(true);
  });
});

// ── context_dir_size ──────────────────────────────────────

describe("context_dir_size", () => {
  test("returns 0 for an empty directory", async () => {
    await contextCreateDirTool.execute({ path: "empty" }, ctx);
    const r = await contextDirSizeTool.execute({ path: "empty" }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.bytes).toBe(0);
    expect(r.files).toBe(0);
  });

  test("includes subdirectories", async () => {
    await seed("a/b.md", "12345"); // 5 bytes
    await seed("a/nested/c.md", "67890"); // 5 bytes
    const r = await contextDirSizeTool.execute({ path: "a" }, ctx);
    expect(r.bytes).toBe(10);
    expect(r.files).toBe(2);
  });
});

// ── context_tree ──────────────────────────────────────

describe("context_tree", () => {
  test("renders a tree with files and folders", async () => {
    await seed("a.md", "x");
    await seed("sub/b.md", "y");
    const r = await contextTreeTool.execute({ path: "", max_depth: 5 }, ctx);
    expect(r.is_error).toBe(false);
    expect(r.tree).toContain("a.md");
    expect(r.tree).toContain("sub");
    expect(r.total_items).toBe(2);
  });

  test("respects max_depth", async () => {
    await seed("a/b/c.md", "x");
    const shallow = await contextTreeTool.execute(
      { path: "", max_depth: 1 },
      ctx,
    );
    // a/ shows up but b/ and c.md are pruned at depth 1.
    expect(shallow.tree).toContain("a");
    expect(shallow.tree).not.toContain("c.md");
  });

  test("returns not_found for a missing path", async () => {
    const r = await contextTreeTool.execute(
      { path: "nope", max_depth: 5 },
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(r.error_type).toBe("not_found");
  });
});
