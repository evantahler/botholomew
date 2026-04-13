import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { type DbConnection, getConnection } from "../../src/db/connection.ts";
import { createContextItem } from "../../src/db/context.ts";
import { migrate } from "../../src/db/schema.ts";
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

let conn: DbConnection;
let ctx: ToolContext;

beforeEach(() => {
  conn = getConnection(":memory:");
  migrate(conn);
  ctx = { conn, projectDir: "/tmp/test", config: { ...DEFAULT_CONFIG } };
});

async function seedFile(
  path: string,
  content: string,
  opts?: { title?: string; description?: string },
) {
  return createContextItem(conn, {
    title: opts?.title ?? path.split("/").pop() ?? path,
    description: opts?.description,
    content,
    contextPath: path,
    mimeType: "text/plain",
    isTextual: true,
  });
}

async function seedBinaryFile(path: string) {
  return createContextItem(conn, {
    title: path.split("/").pop() ?? path,
    content: undefined,
    contextPath: path,
    mimeType: "application/octet-stream",
    isTextual: false,
  });
}

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
    await seedFile("/overwrite.txt", "original");
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
    await seedFile("/readme.md", "line1\nline2\nline3");
    const result = await fileReadTool.execute({ path: "/readme.md" }, ctx);
    expect(result.content).toBe("line1\nline2\nline3");
  });

  test("reads with offset and limit", async () => {
    await seedFile("/lines.txt", "a\nb\nc\nd\ne");
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
    await seedBinaryFile("/image.png");
    expect(fileReadTool.execute({ path: "/image.png" }, ctx)).rejects.toThrow(
      "No text content",
    );
  });
});

// ── file_edit ───────────────────────────────────────────────

describe("file_edit", () => {
  test("replaces lines with a patch", async () => {
    await seedFile("/edit.txt", "line1\nline2\nline3");
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
    await seedFile("/insert.txt", "line1\nline2");
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
    await seedFile("/delete.txt", "line1\nline2\nline3");
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
    await seedFile("/remove.txt", "bye");
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
    await seedFile("/dir/a.txt", "a");
    await seedFile("/dir/b.txt", "b");
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
    await seedFile("/orig.txt", "content");
    const result = await fileCopyTool.execute(
      { src: "/orig.txt", dst: "/copy.txt" },
      ctx,
    );
    expect(result.path).toBe("/copy.txt");

    const read = await fileReadTool.execute({ path: "/copy.txt" }, ctx);
    expect(read.content).toBe("content");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile("/src.txt", "a");
    await seedFile("/dst.txt", "b");
    expect(
      fileCopyTool.execute({ src: "/src.txt", dst: "/dst.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile("/src.txt", "new");
    await seedFile("/dst.txt", "old");
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
    await seedFile("/old.txt", "data");
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
    await seedFile("/a.txt", "a");
    await seedFile("/b.txt", "b");
    expect(
      fileMoveTool.execute({ src: "/a.txt", dst: "/b.txt" }, ctx),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile("/a.txt", "a");
    await seedFile("/b.txt", "b");
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
    await seedFile("/meta.txt", "hello\nworld", {
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
    await seedFile("/there.txt", "hi");
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
    await seedFile("/lines.txt", "a\nb\nc");
    const result = await fileCountLinesTool.execute(
      { path: "/lines.txt" },
      ctx,
    );
    expect(result.lines).toBe(3);
  });

  test("single line file returns 1", async () => {
    await seedFile("/single.txt", "only one line");
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
    await seedBinaryFile("/bin.dat");
    expect(
      fileCountLinesTool.execute({ path: "/bin.dat" }, ctx),
    ).rejects.toThrow("No text content");
  });
});
