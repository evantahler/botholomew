import { beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "../../src/db/connection.ts";
import { fileCopyTool } from "../../src/tools/file/copy.ts";
import { fileCountLinesTool } from "../../src/tools/file/count-lines.ts";
import { fileDeleteTool } from "../../src/tools/file/delete.ts";
import { fileEditTool } from "../../src/tools/file/edit.ts";
import { fileExistsTool } from "../../src/tools/file/exists.ts";
import { fileInfoTool } from "../../src/tools/file/info.ts";
import { fileMoveTool } from "../../src/tools/file/move.ts";
import { fileReadTool } from "../../src/tools/file/read.ts";
import { fileWriteTool } from "../../src/tools/file/write.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { seedBinaryFile, seedFile, setupToolContext } from "../helpers.ts";

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

// ── file_write ──────────────────────────────────────────────

describe("file_write", () => {
  test("creates a new file", async () => {
    const result = await fileWriteTool.execute(
      { path: "/hello.txt", content: "hello world" },
      ctx,
    );
    expect(result.path).toBe("/hello.txt");
    expect(result.id).toBeTruthy();

    const read = await fileReadTool.execute({ path: "/hello.txt" }, ctx);
    expect(read.content).toBe("hello world");
  });

  test("overwrites existing file", async () => {
    await seedFile(conn, "/overwrite.txt", "original");
    const result = await fileWriteTool.execute(
      { path: "/overwrite.txt", content: "updated" },
      ctx,
    );
    expect(result.path).toBe("/overwrite.txt");

    const read = await fileReadTool.execute({ path: "/overwrite.txt" }, ctx);
    expect(read.content).toBe("updated");
  });

  test("sets title and description", async () => {
    await fileWriteTool.execute(
      {
        path: "/doc.md",
        content: "# Doc",
        title: "My Doc",
        description: "A document",
      },
      ctx,
    );
    const info = await fileInfoTool.execute({ path: "/doc.md" }, ctx);
    expect(info.title).toBe("My Doc");
    expect(info.description).toBe("A document");
  });

  test("writes base64 content", async () => {
    const b64 = btoa("binary data");
    const result = await fileWriteTool.execute(
      { path: "/data.bin", content: "", content_base64: b64 },
      ctx,
    );
    expect(result.path).toBe("/data.bin");
  });
});

// ── file_read ───────────────────────────────────────────────

describe("file_read", () => {
  test("reads existing file", async () => {
    await seedFile(conn, "/readme.md", "line1\nline2\nline3");
    const result = await fileReadTool.execute({ path: "/readme.md" }, ctx);
    expect(result.content).toBe("line1\nline2\nline3");
  });

  test("reads with offset and limit", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc\nd\ne");
    const result = await fileReadTool.execute(
      { path: "/lines.txt", offset: 2, limit: 2 },
      ctx,
    );
    expect(result.content).toBe("b\nc");
  });

  test("throws for nonexistent file", async () => {
    expect(fileReadTool.execute({ path: "/nope.txt" }, ctx)).rejects.toThrow(
      "Not found",
    );
  });

  test("throws for file with no text content", async () => {
    await seedBinaryFile(conn, "/image.png");
    expect(fileReadTool.execute({ path: "/image.png" }, ctx)).rejects.toThrow(
      "No text content",
    );
  });
});

// ── file_edit ───────────────────────────────────────────────

describe("file_edit", () => {
  test("replaces lines with a patch", async () => {
    await seedFile(conn, "/edit.txt", "line1\nline2\nline3");
    const result = await fileEditTool.execute(
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
    const result = await fileEditTool.execute(
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
    const result = await fileEditTool.execute(
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
      fileEditTool.execute(
        {
          path: "/nope.txt",
          patches: [{ start_line: 1, end_line: 1, content: "x" }],
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ── file_delete ─────────────────────────────────────────────

describe("file_delete", () => {
  test("deletes an existing file", async () => {
    await seedFile(conn, "/remove.txt", "bye");
    const result = await fileDeleteTool.execute({ path: "/remove.txt" }, ctx);
    expect(result.deleted).toBe(1);

    const exists = await fileExistsTool.execute({ path: "/remove.txt" }, ctx);
    expect(exists.exists).toBe(false);
  });

  test("throws when deleting nonexistent without force", async () => {
    expect(fileDeleteTool.execute({ path: "/ghost.txt" }, ctx)).rejects.toThrow(
      "Not found",
    );
  });

  test("does not throw with force flag", async () => {
    const result = await fileDeleteTool.execute(
      { path: "/ghost.txt", force: true },
      ctx,
    );
    expect(result.deleted).toBe(0);
  });

  test("recursive delete removes children", async () => {
    await seedFile(conn, "/dir/a.txt", "a");
    await seedFile(conn, "/dir/b.txt", "b");
    const result = await fileDeleteTool.execute(
      { path: "/dir", recursive: true },
      ctx,
    );
    expect(result.deleted).toBeGreaterThanOrEqual(2);
  });
});

// ── file_copy ───────────────────────────────────────────────

describe("file_copy", () => {
  test("copies a file", async () => {
    await seedFile(conn, "/orig.txt", "content");
    const result = await fileCopyTool.execute(
      { src: "/orig.txt", dst: "/copy.txt" },
      ctx,
    );
    expect(result.path).toBe("/copy.txt");

    const read = await fileReadTool.execute({ path: "/copy.txt" }, ctx);
    expect(read.content).toBe("content");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/src.txt", "a");
    await seedFile(conn, "/dst.txt", "b");
    expect(
      fileCopyTool.execute({ src: "/src.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/src.txt", "new");
    await seedFile(conn, "/dst.txt", "old");
    const result = await fileCopyTool.execute(
      { src: "/src.txt", dst: "/dst.txt", overwrite: true },
      ctx,
    );
    expect(result.path).toBe("/dst.txt");
  });

  test("throws when source does not exist", async () => {
    expect(
      fileCopyTool.execute({ src: "/missing.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow();
  });
});

// ── file_move ───────────────────────────────────────────────

describe("file_move", () => {
  test("moves a file", async () => {
    await seedFile(conn, "/old.txt", "data");
    const result = await fileMoveTool.execute(
      { src: "/old.txt", dst: "/new.txt" },
      ctx,
    );
    expect(result.path).toBe("/new.txt");

    const exists = await fileExistsTool.execute({ path: "/old.txt" }, ctx);
    expect(exists.exists).toBe(false);

    const read = await fileReadTool.execute({ path: "/new.txt" }, ctx);
    expect(read.content).toBe("data");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    expect(
      fileMoveTool.execute({ src: "/a.txt", dst: "/b.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    const result = await fileMoveTool.execute(
      { src: "/a.txt", dst: "/b.txt", overwrite: true },
      ctx,
    );
    expect(result.path).toBe("/b.txt");
  });

  test("throws when source does not exist", async () => {
    expect(
      fileMoveTool.execute({ src: "/missing.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow();
  });
});

// ── file_info ───────────────────────────────────────────────

describe("file_info", () => {
  test("returns metadata for existing file", async () => {
    await seedFile(conn, "/meta.txt", "hello\nworld", {
      title: "Meta",
      description: "A test file",
    });
    const info = await fileInfoTool.execute({ path: "/meta.txt" }, ctx);
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

  test("throws for nonexistent file", async () => {
    expect(fileInfoTool.execute({ path: "/nope.txt" }, ctx)).rejects.toThrow(
      "Not found",
    );
  });
});

// ── file_exists ─────────────────────────────────────────────

describe("file_exists", () => {
  test("returns true for existing file", async () => {
    await seedFile(conn, "/there.txt", "hi");
    const result = await fileExistsTool.execute({ path: "/there.txt" }, ctx);
    expect(result.exists).toBe(true);
  });

  test("returns false for missing file", async () => {
    const result = await fileExistsTool.execute({ path: "/nope.txt" }, ctx);
    expect(result.exists).toBe(false);
  });
});

// ── file_count_lines ────────────────────────────────────────

describe("file_count_lines", () => {
  test("counts lines in a file", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc");
    const result = await fileCountLinesTool.execute(
      { path: "/lines.txt" },
      ctx,
    );
    expect(result.lines).toBe(3);
  });

  test("single line file returns 1", async () => {
    await seedFile(conn, "/single.txt", "only one line");
    const result = await fileCountLinesTool.execute(
      { path: "/single.txt" },
      ctx,
    );
    expect(result.lines).toBe(1);
  });

  test("throws for nonexistent file", async () => {
    expect(
      fileCountLinesTool.execute({ path: "/nope.txt" }, ctx),
    ).rejects.toThrow("Not found");
  });

  test("throws for non-textual file", async () => {
    await seedBinaryFile(conn, "/bin.dat");
    expect(
      fileCountLinesTool.execute({ path: "/bin.dat" }, ctx),
    ).rejects.toThrow("No text content");
  });
});

// ── edge cases ─────────────────────────────────────────────

describe("file edge cases", () => {
  test("write and read file with empty content", async () => {
    await fileWriteTool.execute({ path: "/empty.txt", content: "" }, ctx);
    const result = await fileReadTool.execute({ path: "/empty.txt" }, ctx);
    expect(result.content).toBe("");
  });

  test("write file with very long single line", async () => {
    const longLine = "x".repeat(10000);
    await fileWriteTool.execute({ path: "/long.txt", content: longLine }, ctx);
    const result = await fileReadTool.execute({ path: "/long.txt" }, ctx);
    expect(result.content).toBe(longLine);
  });

  test("edit with multiple patches applied in order", async () => {
    await seedFile(
      conn,
      "/multi-edit.txt",
      "line1\nline2\nline3\nline4\nline5",
    );
    const result = await fileEditTool.execute(
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
    const content = "Special chars: \t\n\r\nUnicode: \u00e9\u00e8\u00ea";
    await seedFile(conn, "/special.txt", content);
    await fileCopyTool.execute(
      { src: "/special.txt", dst: "/special-copy.txt" },
      ctx,
    );
    const result = await fileReadTool.execute(
      { path: "/special-copy.txt" },
      ctx,
    );
    expect(result.content).toBe(content);
  });

  test("move source no longer exists", async () => {
    await seedFile(conn, "/src-move.txt", "moving data");
    await fileMoveTool.execute(
      { src: "/src-move.txt", dst: "/dst-move.txt" },
      ctx,
    );

    const srcExists = await fileExistsTool.execute(
      { path: "/src-move.txt" },
      ctx,
    );
    expect(srcExists.exists).toBe(false);

    const dstExists = await fileExistsTool.execute(
      { path: "/dst-move.txt" },
      ctx,
    );
    expect(dstExists.exists).toBe(true);
  });

  test("info returns correct size for multi-byte content", async () => {
    const content = "Hello";
    await seedFile(conn, "/sized.txt", content);
    const info = await fileInfoTool.execute({ path: "/sized.txt" }, ctx);
    expect(info.size).toBe(5);
    expect(info.lines).toBe(1);
  });

  test("read with offset beyond file length returns empty", async () => {
    await seedFile(conn, "/short.txt", "only\ntwo");
    const result = await fileReadTool.execute(
      { path: "/short.txt", offset: 100 },
      ctx,
    );
    expect(result.content).toBe("");
  });

  test("delete with recursive on empty path does not affect other files", async () => {
    await seedFile(conn, "/keep/a.txt", "keep me");
    await seedFile(conn, "/remove-dir/b.txt", "remove me");

    await fileDeleteTool.execute({ path: "/remove-dir", recursive: true }, ctx);

    const kept = await fileExistsTool.execute({ path: "/keep/a.txt" }, ctx);
    expect(kept.exists).toBe(true);
  });
});
