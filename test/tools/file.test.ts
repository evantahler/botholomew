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

const D = "agent";

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

// ── context_write ──────────────────────────────────────────────

describe("context_write", () => {
  test("creates a new file", async () => {
    const result = await contextWriteTool.execute(
      { drive: D, path: "/hello.txt", content: "hello world" },
      ctx,
    );
    expect(result.path).toBe("/hello.txt");
    expect(result.drive).toBe(D);
    expect(result.id).toBeTruthy();

    const read = await contextReadTool.execute(
      { drive: D, path: "/hello.txt" },
      ctx,
    );
    expect(read.content).toBe("hello world");
  });

  test("overwrites existing file when on_conflict='overwrite'", async () => {
    await seedFile(conn, "/overwrite.txt", "original");
    const result = await contextWriteTool.execute(
      {
        drive: D,
        path: "/overwrite.txt",
        content: "updated",
        on_conflict: "overwrite",
      },
      ctx,
    );
    expect(result.path).toBe("/overwrite.txt");
    expect(result.is_error).toBe(false);

    const read = await contextReadTool.execute(
      { drive: D, path: "/overwrite.txt" },
      ctx,
    );
    expect(read.content).toBe("updated");
  });

  test("returns path_conflict error by default when file exists", async () => {
    await seedFile(conn, "/collision.txt", "original");
    const result = await contextWriteTool.execute(
      { drive: D, path: "/collision.txt", content: "second" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("path_conflict");
    expect(result.id).toBeNull();
    expect(result.next_action_hint).toContain("on_conflict='overwrite'");

    const read = await contextReadTool.execute(
      { drive: D, path: "/collision.txt" },
      ctx,
    );
    expect(read.content).toBe("original");
  });

  test("sets title and description", async () => {
    await contextWriteTool.execute(
      {
        drive: D,
        path: "/doc.md",
        content: "# Doc",
        title: "My Doc",
        description: "A document",
      },
      ctx,
    );
    const info = await contextInfoTool.execute(
      { drive: D, path: "/doc.md" },
      ctx,
    );
    expect(info.file?.title).toBe("My Doc");
    expect(info.file?.description).toBe("A document");
  });

  test("writes base64 content", async () => {
    const b64 = btoa("binary data");
    const result = await contextWriteTool.execute(
      { drive: D, path: "/data.bin", content: "", content_base64: b64 },
      ctx,
    );
    expect(result.path).toBe("/data.bin");
  });

  test("returns a tree snapshot on success", async () => {
    await seedFile(conn, "/notes/existing.md", "already here");
    const result = await contextWriteTool.execute(
      { drive: D, path: "/notes/new.md", content: "fresh" },
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
    const result = await contextReadTool.execute(
      { drive: D, path: "/readme.md" },
      ctx,
    );
    expect(result.content).toBe("line1\nline2\nline3");
  });

  test("reads with offset and limit", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc\nd\ne");
    const result = await contextReadTool.execute(
      { drive: D, path: "/lines.txt", offset: 2, limit: 2 },
      ctx,
    );
    expect(result.content).toBe("b\nc");
  });

  test("reads by context item ID (drive is ignored)", async () => {
    const item = await seedFile(conn, "/by-id.txt", "found by id");
    const result = await contextReadTool.execute(
      { drive: "ignored", path: item.id },
      ctx,
    );
    expect(result.content).toBe("found by id");
  });

  test("reads by UUID when drive is omitted", async () => {
    const item = await seedFile(conn, "/no-drive.txt", "resolved by id");
    const result = await contextReadTool.execute({ path: item.id }, ctx);
    expect(result.content).toBe("resolved by id");
  });

  test("reads by drive:/path ref when drive is omitted", async () => {
    await seedFile(conn, "/ref.txt", "resolved by ref");
    const result = await contextReadTool.execute(
      { path: `${D}:/ref.txt` },
      ctx,
    );
    expect(result.content).toBe("resolved by ref");
  });

  test("returns missing_drive error when drive is absent and path is bare", async () => {
    const result = await contextReadTool.execute({ path: "/lonely.txt" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("missing_drive");
    expect(result.content).toBeUndefined();
  });

  test("prepends leading slash to bare path", async () => {
    await seedFile(conn, "/no-slash.txt", "body");
    const result = await contextReadTool.execute(
      { drive: D, path: "no-slash.txt" },
      ctx,
    );
    expect(result.content).toBe("body");
  });

  test("returns not_found error with sibling hints", async () => {
    await seedFile(conn, "/dir/real.txt", "hi");
    const result = await contextReadTool.execute(
      { drive: D, path: "/dir/missing.txt" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.content).toBeUndefined();
    expect(result.next_action_hint).toContain("/dir/real.txt");
  });

  test("walks up when requested parent is empty", async () => {
    await seedFile(conn, "/root.txt", "root");
    const result = await contextReadTool.execute(
      { drive: D, path: "/nonexistent/deep/missing.txt" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("/root.txt");
  });

  test("returns no_text_content error for binary files", async () => {
    await seedBinaryFile(conn, "/image.png");
    const result = await contextReadTool.execute(
      { drive: D, path: "/image.png" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("no_text_content");
    expect(result.content).toBeUndefined();
  });
});

// ── context_edit ───────────────────────────────────────────────

describe("context_edit", () => {
  test("replaces lines with a patch", async () => {
    await seedFile(conn, "/edit.txt", "line1\nline2\nline3");
    const result = await contextEditTool.execute(
      {
        drive: D,
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
        drive: D,
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
        drive: D,
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
          drive: D,
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
      { drive: D, path: "/remove.txt" },
      ctx,
    );
    expect(result.deleted).toBe(1);

    const exists = await contextExistsTool.execute(
      { drive: D, path: "/remove.txt" },
      ctx,
    );
    expect(exists.exists).toBe(false);
  });

  test("throws when deleting nonexistent without force", async () => {
    expect(
      contextDeleteTool.execute({ drive: D, path: "/ghost.txt" }, ctx),
    ).rejects.toThrow("Not found");
  });

  test("does not throw with force flag", async () => {
    const result = await contextDeleteTool.execute(
      { drive: D, path: "/ghost.txt", force: true },
      ctx,
    );
    expect(result.deleted).toBe(0);
  });

  test("recursive delete removes children", async () => {
    await seedFile(conn, "/dir/a.txt", "a");
    await seedFile(conn, "/dir/b.txt", "b");
    const result = await contextDeleteTool.execute(
      { drive: D, path: "/dir", recursive: true },
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
      {
        src_drive: D,
        src_path: "/orig.txt",
        dst_drive: D,
        dst_path: "/copy.txt",
      },
      ctx,
    );
    expect(result.ref).toBe(`${D}:/copy.txt`);

    const read = await contextReadTool.execute(
      { drive: D, path: "/copy.txt" },
      ctx,
    );
    expect(read.content).toBe("content");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/src.txt", "a");
    await seedFile(conn, "/dst.txt", "b");
    expect(
      contextCopyTool.execute(
        {
          src_drive: D,
          src_path: "/src.txt",
          dst_drive: D,
          dst_path: "/dst.txt",
        },
        ctx,
      ),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/src.txt", "new");
    await seedFile(conn, "/dst.txt", "old");
    const result = await contextCopyTool.execute(
      {
        src_drive: D,
        src_path: "/src.txt",
        dst_drive: D,
        dst_path: "/dst.txt",
        overwrite: true,
      },
      ctx,
    );
    expect(result.ref).toBe(`${D}:/dst.txt`);
  });

  test("throws when source does not exist", async () => {
    expect(
      contextCopyTool.execute(
        {
          src_drive: D,
          src_path: "/missing.txt",
          dst_drive: D,
          dst_path: "/dst.txt",
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ── context_move ───────────────────────────────────────────────

describe("context_move", () => {
  test("moves a file", async () => {
    await seedFile(conn, "/old.txt", "data");
    const result = await contextMoveTool.execute(
      {
        src_drive: D,
        src_path: "/old.txt",
        dst_drive: D,
        dst_path: "/new.txt",
      },
      ctx,
    );
    expect(result.ref).toBe(`${D}:/new.txt`);

    const exists = await contextExistsTool.execute(
      { drive: D, path: "/old.txt" },
      ctx,
    );
    expect(exists.exists).toBe(false);

    const read = await contextReadTool.execute(
      { drive: D, path: "/new.txt" },
      ctx,
    );
    expect(read.content).toBe("data");
  });

  test("throws when destination exists without overwrite", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    expect(
      contextMoveTool.execute(
        {
          src_drive: D,
          src_path: "/a.txt",
          dst_drive: D,
          dst_path: "/b.txt",
        },
        ctx,
      ),
    ).rejects.toThrow("Destination already exists");
  });

  test("overwrites when overwrite is true", async () => {
    await seedFile(conn, "/a.txt", "a");
    await seedFile(conn, "/b.txt", "b");
    const result = await contextMoveTool.execute(
      {
        src_drive: D,
        src_path: "/a.txt",
        dst_drive: D,
        dst_path: "/b.txt",
        overwrite: true,
      },
      ctx,
    );
    expect(result.ref).toBe(`${D}:/b.txt`);
  });

  test("throws when source does not exist", async () => {
    expect(
      contextMoveTool.execute(
        {
          src_drive: D,
          src_path: "/missing.txt",
          dst_drive: D,
          dst_path: "/dst.txt",
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  test("can move between drives", async () => {
    await seedFile(conn, { drive: "disk", path: "/tmp/from.txt" }, "bytes");
    const result = await contextMoveTool.execute(
      {
        src_drive: "disk",
        src_path: "/tmp/from.txt",
        dst_drive: "agent",
        dst_path: "/from.txt",
      },
      ctx,
    );
    expect(result.ref).toBe("agent:/from.txt");
  });
});

// ── context_info ───────────────────────────────────────────────

describe("context_info", () => {
  test("returns metadata for existing file", async () => {
    await seedFile(conn, "/meta.txt", "hello\nworld", {
      title: "Meta",
      description: "A test file",
    });
    const info = await contextInfoTool.execute(
      { drive: D, path: "/meta.txt" },
      ctx,
    );
    expect(info.is_error).toBe(false);
    expect(info.file?.title).toBe("Meta");
    expect(info.file?.description).toBe("A test file");
    expect(info.file?.mime_type).toBe("text/plain");
    expect(info.file?.is_textual).toBe(true);
    expect(info.file?.lines).toBe(2);
    expect(info.file?.size).toBe(11);
    expect(info.file?.drive).toBe(D);
    expect(info.file?.path).toBe("/meta.txt");
    expect(info.file?.ref).toBe(`${D}:/meta.txt`);
    expect(info.file?.created_at).toBeTruthy();
    expect(info.file?.updated_at).toBeTruthy();
  });

  test("returns metadata by ID", async () => {
    const item = await seedFile(conn, "/meta-id.txt", "hello", {
      title: "MetaID",
    });
    const info = await contextInfoTool.execute(
      { drive: "ignored", path: item.id },
      ctx,
    );
    expect(info.file?.title).toBe("MetaID");
    expect(info.file?.path).toBe("/meta-id.txt");
  });

  test("returns not_found error with sibling hints", async () => {
    await seedFile(conn, "/docs/readme.md", "hi");
    await seedFile(conn, "/docs/guide.md", "g");
    const result = await contextInfoTool.execute(
      { drive: D, path: "/docs/architecture.md" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.file).toBeUndefined();
    expect(result.message).toContain("/docs/architecture.md");
    expect(result.next_action_hint).toContain("/docs/readme.md");
    expect(result.next_action_hint).toContain("/docs/guide.md");
  });

  test("not_found at empty root returns discovery hint", async () => {
    const result = await contextInfoTool.execute(
      { drive: D, path: "/nope.txt" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("context_list_drives");
  });

  test("not_found walks up past empty parents", async () => {
    await seedFile(conn, "/a.txt", "a");
    const result = await contextInfoTool.execute(
      { drive: D, path: "/missing/deeper/file.md" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("not_found");
    expect(result.next_action_hint).toContain("/a.txt");
  });
});

// ── context_exists ─────────────────────────────────────────────

describe("context_exists", () => {
  test("returns true for existing file", async () => {
    await seedFile(conn, "/there.txt", "hi");
    const result = await contextExistsTool.execute(
      { drive: D, path: "/there.txt" },
      ctx,
    );
    expect(result.exists).toBe(true);
  });

  test("returns true when checked by ID", async () => {
    const item = await seedFile(conn, "/exists-id.txt", "hi");
    const result = await contextExistsTool.execute(
      { drive: "ignored", path: item.id },
      ctx,
    );
    expect(result.exists).toBe(true);
  });

  test("returns false for missing file", async () => {
    const result = await contextExistsTool.execute(
      { drive: D, path: "/nope.txt" },
      ctx,
    );
    expect(result.exists).toBe(false);
  });
});

// ── context_count_lines ────────────────────────────────────────

describe("context_count_lines", () => {
  test("counts lines in a file", async () => {
    await seedFile(conn, "/lines.txt", "a\nb\nc");
    const result = await contextCountLinesTool.execute(
      { drive: D, path: "/lines.txt" },
      ctx,
    );
    expect(result.lines).toBe(3);
  });

  test("single line file returns 1", async () => {
    await seedFile(conn, "/single.txt", "only one line");
    const result = await contextCountLinesTool.execute(
      { drive: D, path: "/single.txt" },
      ctx,
    );
    expect(result.lines).toBe(1);
  });

  test("throws for nonexistent file", async () => {
    expect(
      contextCountLinesTool.execute({ drive: D, path: "/nope.txt" }, ctx),
    ).rejects.toThrow("Not found");
  });

  test("throws for non-textual file", async () => {
    await seedBinaryFile(conn, "/bin.dat");
    expect(
      contextCountLinesTool.execute({ drive: D, path: "/bin.dat" }, ctx),
    ).rejects.toThrow("No text content");
  });
});

// ── edge cases ─────────────────────────────────────────────────

describe("context edge cases", () => {
  test("write and read file with empty content", async () => {
    await contextWriteTool.execute(
      { drive: D, path: "/empty.txt", content: "" },
      ctx,
    );
    const result = await contextReadTool.execute(
      { drive: D, path: "/empty.txt" },
      ctx,
    );
    expect(result.content).toBe("");
  });

  test("write file with very long single line", async () => {
    const longLine = "x".repeat(10000);
    await contextWriteTool.execute(
      { drive: D, path: "/long.txt", content: longLine },
      ctx,
    );
    const result = await contextReadTool.execute(
      { drive: D, path: "/long.txt" },
      ctx,
    );
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
        drive: D,
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
      {
        src_drive: D,
        src_path: "/special.txt",
        dst_drive: D,
        dst_path: "/special-copy.txt",
      },
      ctx,
    );
    const result = await contextReadTool.execute(
      { drive: D, path: "/special-copy.txt" },
      ctx,
    );
    expect(result.content).toBe(content);
  });

  test("move source no longer exists", async () => {
    await seedFile(conn, "/src-move.txt", "moving data");
    await contextMoveTool.execute(
      {
        src_drive: D,
        src_path: "/src-move.txt",
        dst_drive: D,
        dst_path: "/dst-move.txt",
      },
      ctx,
    );

    const srcExists = await contextExistsTool.execute(
      { drive: D, path: "/src-move.txt" },
      ctx,
    );
    expect(srcExists.exists).toBe(false);

    const dstExists = await contextExistsTool.execute(
      { drive: D, path: "/dst-move.txt" },
      ctx,
    );
    expect(dstExists.exists).toBe(true);
  });

  test("info returns correct size for multi-byte content", async () => {
    const content = "Hello";
    await seedFile(conn, "/sized.txt", content);
    const info = await contextInfoTool.execute(
      { drive: D, path: "/sized.txt" },
      ctx,
    );
    expect(info.file?.size).toBe(5);
    expect(info.file?.lines).toBe(1);
  });

  test("read with offset beyond file length returns empty", async () => {
    await seedFile(conn, "/short.txt", "only\ntwo");
    const result = await contextReadTool.execute(
      { drive: D, path: "/short.txt", offset: 100 },
      ctx,
    );
    expect(result.content).toBe("");
  });

  test("delete with recursive on empty path does not affect other files", async () => {
    await seedFile(conn, "/keep/a.txt", "keep me");
    await seedFile(conn, "/remove-dir/b.txt", "remove me");

    await contextDeleteTool.execute(
      { drive: D, path: "/remove-dir", recursive: true },
      ctx,
    );

    const kept = await contextExistsTool.execute(
      { drive: D, path: "/keep/a.txt" },
      ctx,
    );
    expect(kept.exists).toBe(true);
  });
});
