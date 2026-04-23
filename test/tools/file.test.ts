import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
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
import { seedBinaryFile, seedFile, setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

// ── context_write ──────────────────────────────────────────────

describe("context_write", () => {
  test("creates a new file", async () => {
    const result = await contextWriteTool.execute(
      { path: "/hello.txt", content: "hello world" },
      ctx,
    );
    expect(result.path).toBe("/hello.txt");
    expect(result.id).toBeTruthy();

    const read = await contextReadTool.execute({ path: "/hello.txt" }, ctx);
    expect(read.content).toBe("hello world");
  });

  test("overwrites existing file when on_conflict='overwrite'", async () => {
    await seedFile(conn, "/overwrite.txt", "original");
    const result = await contextWriteTool.execute(
      {
        path: "/overwrite.txt",
        content: "updated",
        on_conflict: "overwrite",
      },
      ctx,
    );
    expect(result.path).toBe("/overwrite.txt");
    expect(result.is_error).toBe(false);

    const read = await contextReadTool.execute({ path: "/overwrite.txt" }, ctx);
    expect(read.content).toBe("updated");
  });

  test("returns path_conflict error by default when file exists", async () => {
    await seedFile(conn, "/collision.txt", "original");
    const result = await contextWriteTool.execute(
      { path: "/collision.txt", content: "second" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("path_conflict");
    expect(result.id).toBeNull();
    expect(result.next_action_hint).toContain("on_conflict='overwrite'");

    // Original content preserved
    const read = await contextReadTool.execute({ path: "/collision.txt" }, ctx);
    expect(read.content).toBe("original");
  });

  test("sets title and description", async () => {
    await contextWriteTool.execute(
      {
        path: "/doc.md",
        content: "# Doc",
        title: "My Doc",
        description: "A document",
      },
      ctx,
    );
    const info = await contextInfoTool.execute({ path: "/doc.md" }, ctx);
    expect(info.title).toBe("My Doc");
    expect(info.description).toBe("A document");
  });

  test("writes base64 content", async () => {
    const b64 = btoa("binary data");
    const result = await contextWriteTool.execute(
      { path: "/data.bin", content: "", content_base64: b64 },
      ctx,
    );
    expect(result.path).toBe("/data.bin");
  });

  test("returns a tree snapshot on success", async () => {
    await seedFile(conn, "/notes/existing.md", "already here");
    const result = await contextWriteTool.execute(
      { path: "/notes/new.md", content: "fresh" },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.tree).toBeTruthy();
    expect(result.tree).toContain("notes/");
    expect(result.tree).toContain("new.md");
    expect(result.tree).toContain("existing.md");
  });
});

// ── context_read ───────────────────────────────────────────────

describe("context_read", () => {
  test("reads existing file", async () => {
    await seedFile(conn, "/readme.md", "line1\nline2\nline3");
    const result = await contextReadTool.execute({ path: "/readme.md" }, ctx);
    expect(result.content).toBe("line1\nline2\nline3");
  });

  test("reads with offset and limit", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc\nd\ne");
    const result = await contextReadTool.execute(
      { path: "/lines.txt", offset: 2, limit: 2 },
      ctx,
    );
    expect(result.content).toBe("b\nc");
  });

  test("reads by context item ID", async () => {
    const item = await seedFile(conn, "/by-id.txt", "found by id");
    const result = await contextReadTool.execute({ path: item.id }, ctx);
    expect(result.content).toBe("found by id");
  });

  test("throws for nonexistent file", async () => {
    expect(contextReadTool.execute({ path: "/nope.txt" }, ctx)).rejects.toThrow(
      "Not found",
    );
  });

  test("throws for file with no text content", async () => {
    await seedBinaryFile(conn, "/image.png");
    expect(
      contextReadTool.execute({ path: "/image.png" }, ctx),
    ).rejects.toThrow("No text content");
  });
});

// ── context_edit ───────────────────────────────────────────────

describe("context_edit", () => {
  test("replaces lines with a patch", async () => {
    await seedFile(conn, "/edit.txt", "line1\nline2\nline3");
    const result = await contextEditTool.execute(
      {
        path: "/edit.txt",
        patches: [{ start_line: 2, end_line: 2, content: "replaced" }],
      },
      ctx,
    );
    expect(result.applied).toBe(1);
    expect(result.content).toContain("replaced");
    expect(result.content).not.toContain("line2");
  });

  test("inserts lines when end_line is 0", async () => {
    await seedFile(conn, "/insert.txt", "line1\nline2");
    const result = await contextEditTool.execute(
      {
        path: "/insert.txt",
        patches: [{ start_line: 2, end_line: 0, content: "inserted" }],
      },
      ctx,
    );
    expect(result.applied).toBe(1);
    expect(result.content).toContain("inserted");
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
  });

  test("deletes lines with empty content", async () => {
    await seedFile(conn, "/delete.txt", "line1\nline2\nline3");
    const result = await contextEditTool.execute(
      {
        path: "/delete.txt",
        patches: [{ start_line: 2, end_line: 2, content: "" }],
      },
      ctx,
    );
    expect(result.applied).toBe(1);
    expect(result.content).not.toContain("line2");
  });

  test("throws for nonexistent file", async () => {
    expect(
      contextEditTool.execute(
        {
          path: "/nope.txt",
          patches: [{ start_line: 1, end_line: 1, content: "x" }],
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ── context_delete ─────────────────────────────────────────────

describe("context_delete", () => {
  test("deletes an existing file", async () => {
    await seedFile(conn, "/remove.txt", "bye");
    const result = await contextDeleteTool.execute(
      { path: "/remove.txt" },
      ctx,
    );
    expect(result.deleted).toBe(1);

    const exists = await contextExistsTool.execute(
      { path: "/remove.txt" },
      ctx,
    );
    expect(exists.exists).toBe(false);
  });

  test("throws when deleting nonexistent without force", async () => {
    expect(
      contextDeleteTool.execute({ path: "/ghost.txt" }, ctx),
    ).rejects.toThrow("Not found");
  });

  test("does not throw with force flag", async () => {
    const result = await contextDeleteTool.execute(
      { path: "/ghost.txt", force: true },
      ctx,
    );
    expect(result.deleted).toBe(0);
  });

  test("recursive delete removes children", async () => {
    await seedFile(conn, "/dir/a.txt", "a");
    await seedFile(conn, "/dir/b.txt", "b");
    const result = await contextDeleteTool.execute(
      { path: "/dir", recursive: true },
      ctx,
    );
    expect(result.deleted).toBeGreaterThanOrEqual(2);
  });
});

// ── context_copy ───────────────────────────────────────────────

describe("context_copy", () => {
  test("copies a file", async () => {
    await seedFile(conn, "/orig.txt", "content");
    const result = await contextCopyTool.execute(
      { src: "/orig.txt", dst: "/copy.txt" },
      ctx,
    );
    expect(result.path).toBe("/copy.txt");

    const read = await contextReadTool.execute({ path: "/copy.txt" }, ctx);
    expect(read.content).toBe("content");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/src.txt", "a");
    await seedFile(conn, "/dst.txt", "b");
    expect(
      contextCopyTool.execute({ src: "/src.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/src.txt", "new");
    await seedFile(conn, "/dst.txt", "old");
    const result = await contextCopyTool.execute(
      { src: "/src.txt", dst: "/dst.txt", overwrite: true },
      ctx,
    );
    expect(result.path).toBe("/dst.txt");
  });

  test("throws when source does not exist", async () => {
    expect(
      contextCopyTool.execute({ src: "/missing.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow();
  });
});

// ── context_move ───────────────────────────────────────────────

describe("context_move", () => {
  test("moves a file", async () => {
    await seedFile(conn, "/old.txt", "data");
    const result = await contextMoveTool.execute(
      { src: "/old.txt", dst: "/new.txt" },
      ctx,
    );
    expect(result.path).toBe("/new.txt");

    const exists = await contextExistsTool.execute({ path: "/old.txt" }, ctx);
    expect(exists.exists).toBe(false);

    const read = await contextReadTool.execute({ path: "/new.txt" }, ctx);
    expect(read.content).toBe("data");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    expect(
      contextMoveTool.execute({ src: "/a.txt", dst: "/b.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    const result = await contextMoveTool.execute(
      { src: "/a.txt", dst: "/b.txt", overwrite: true },
      ctx,
    );
    expect(result.path).toBe("/b.txt");
  });

  test("throws when source does not exist", async () => {
    expect(
      contextMoveTool.execute({ src: "/missing.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow();
  });
});

// ── context_info ───────────────────────────────────────────────

describe("context_info", () => {
  test("returns metadata for existing file", async () => {
    await seedFile(conn, "/meta.txt", "hello\nworld", {
      title: "Meta",
      description: "A test file",
    });
    const info = await contextInfoTool.execute({ path: "/meta.txt" }, ctx);
    expect(info.title).toBe("Meta");
    expect(info.description).toBe("A test file");
    expect(info.mime_type).toBe("text/plain");
    expect(info.is_textual).toBe(true);
    expect(info.lines).toBe(2);
    expect(info.size).toBe(11);
    expect(info.context_path).toBe("/meta.txt");
    expect(info.created_at).toBeTruthy();
    expect(info.updated_at).toBeTruthy();
  });

  test("returns metadata by ID", async () => {
    const item = await seedFile(conn, "/meta-id.txt", "hello", {
      title: "MetaID",
    });
    const info = await contextInfoTool.execute({ path: item.id }, ctx);
    expect(info.title).toBe("MetaID");
    expect(info.context_path).toBe("/meta-id.txt");
  });

  test("throws for nonexistent file", async () => {
    expect(contextInfoTool.execute({ path: "/nope.txt" }, ctx)).rejects.toThrow(
      "Not found",
    );
  });
});

// ── context_exists ─────────────────────────────────────────────

describe("context_exists", () => {
  test("returns true for existing file", async () => {
    await seedFile(conn, "/there.txt", "hi");
    const result = await contextExistsTool.execute({ path: "/there.txt" }, ctx);
    expect(result.exists).toBe(true);
  });

  test("returns true when checked by ID", async () => {
    const item = await seedFile(conn, "/exists-id.txt", "hi");
    const result = await contextExistsTool.execute({ path: item.id }, ctx);
    expect(result.exists).toBe(true);
  });

  test("returns false for missing file", async () => {
    const result = await contextExistsTool.execute({ path: "/nope.txt" }, ctx);
    expect(result.exists).toBe(false);
  });
});

// ── context_count_lines ────────────────────────────────────────

describe("context_count_lines", () => {
  test("counts lines in a file", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc");
    const result = await contextCountLinesTool.execute(
      { path: "/lines.txt" },
      ctx,
    );
    expect(result.lines).toBe(3);
  });

  test("counts lines by ID", async () => {
    const item = await seedFile(conn, "/count-id.txt", "a\nb\nc");
    const result = await contextCountLinesTool.execute({ path: item.id }, ctx);
    expect(result.lines).toBe(3);
  });

  test("single line file returns 1", async () => {
    await seedFile(conn, "/single.txt", "only one line");
    const result = await contextCountLinesTool.execute(
      { path: "/single.txt" },
      ctx,
    );
    expect(result.lines).toBe(1);
  });

  test("throws for nonexistent file", async () => {
    expect(
      contextCountLinesTool.execute({ path: "/nope.txt" }, ctx),
    ).rejects.toThrow("Not found");
  });

  test("throws for non-textual file", async () => {
    await seedBinaryFile(conn, "/bin.dat");
    expect(
      contextCountLinesTool.execute({ path: "/bin.dat" }, ctx),
    ).rejects.toThrow("No text content");
  });
});

// ── edge cases ─────────────────────────────────────────────────

describe("context edge cases", () => {
  test("write and read file with empty content", async () => {
    await contextWriteTool.execute({ path: "/empty.txt", content: "" }, ctx);
    const result = await contextReadTool.execute({ path: "/empty.txt" }, ctx);
    expect(result.content).toBe("");
  });

  test("write file with very long single line", async () => {
    const longLine = "x".repeat(10000);
    await contextWriteTool.execute(
      { path: "/long.txt", content: longLine },
      ctx,
    );
    const result = await contextReadTool.execute({ path: "/long.txt" }, ctx);
    expect(result.content).toBe(longLine);
  });

  test("edit with multiple patches applied in order", async () => {
    await seedFile(
      conn,
      "/multi-edit.txt",
      "line1\nline2\nline3\nline4\nline5",
    );
    const result = await contextEditTool.execute(
      {
        path: "/multi-edit.txt",
        patches: [
          { start_line: 1, end_line: 1, content: "REPLACED1" },
          { start_line: 3, end_line: 3, content: "REPLACED3" },
        ],
      },
      ctx,
    );
    expect(result.applied).toBe(2);
    expect(result.content).toContain("REPLACED1");
    expect(result.content).toContain("REPLACED3");
    expect(result.content).toContain("line2");
  });

  test("copy preserves content exactly", async () => {
    const content = "Special chars: \t\n\r\nUnicode: éèê";
    await seedFile(conn, "/special.txt", content);
    await contextCopyTool.execute(
      { src: "/special.txt", dst: "/special-copy.txt" },
      ctx,
    );
    const result = await contextReadTool.execute(
      { path: "/special-copy.txt" },
      ctx,
    );
    expect(result.content).toBe(content);
  });

  test("move source no longer exists", async () => {
    await seedFile(conn, "/src-move.txt", "moving data");
    await contextMoveTool.execute(
      { src: "/src-move.txt", dst: "/dst-move.txt" },
      ctx,
    );

    const srcExists = await contextExistsTool.execute(
      { path: "/src-move.txt" },
      ctx,
    );
    expect(srcExists.exists).toBe(false);

    const dstExists = await contextExistsTool.execute(
      { path: "/dst-move.txt" },
      ctx,
    );
    expect(dstExists.exists).toBe(true);
  });

  test("info returns correct size for multi-byte content", async () => {
    const content = "Hello";
    await seedFile(conn, "/sized.txt", content);
    const info = await contextInfoTool.execute({ path: "/sized.txt" }, ctx);
    expect(info.size).toBe(5);
    expect(info.lines).toBe(1);
  });

  test("read with offset beyond file length returns empty", async () => {
    await seedFile(conn, "/short.txt", "only\ntwo");
    const result = await contextReadTool.execute(
      { path: "/short.txt", offset: 100 },
      ctx,
    );
    expect(result.content).toBe("");
  });

  test("delete with recursive on empty path does not affect other files", async () => {
    await seedFile(conn, "/keep/a.txt", "keep me");
    await seedFile(conn, "/remove-dir/b.txt", "remove me");

    await contextDeleteTool.execute(
      { path: "/remove-dir", recursive: true },
      ctx,
    );

    const kept = await contextExistsTool.execute({ path: "/keep/a.txt" }, ctx);
    expect(kept.exists).toBe(true);
  });
});
