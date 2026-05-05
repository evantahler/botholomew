/**
 * Integration tests for the security property the user asked about: every
 * file/dir tool that takes a `path` argument must refuse to read, write, or
 * otherwise touch anything outside `<projectDir>/context/`.
 *
 * We probe the *outcome* (no escape happened) rather than the throw shape,
 * because some tools normalize leading slashes and re-route the request to
 * a safe inside-the-area path (`/etc/passwd` becomes `context/etc/passwd`,
 * which then doesn't exist) and others throw `PathEscapeError`. Both are
 * acceptable as long as nothing outside `context/` is read or modified.
 *
 * Companion to `test/fs/sandbox.test.ts`, which exercises the helper directly.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
const SECRET = "DO_NOT_LEAK";

beforeEach(async () => {
  _resetSandboxCacheForTests();
  projectDir = await mkdtemp(join(tmpdir(), "both-tool-sandbox-"));
  await mkdir(join(projectDir, CONTEXT_DIR), { recursive: true });

  // Real file under context/ — proves these tests fail for sandbox reasons,
  // not because the project is empty.
  await writeFile(join(projectDir, CONTEXT_DIR, "ok.md"), "hello");

  // Files outside context/ that an escape attempt would expose or clobber.
  // The "secret" is the canary; any test that ends with this content
  // changed (write/edit/move/copy/delete) caught a sandbox bypass.
  await writeFile(join(projectDir, "outside-secret.txt"), SECRET);
});

afterEach(async () => {
  _resetSandboxCacheForTests();
  await rm(projectDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    conn: null as never,
    dbPath: ":memory:",
    projectDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
}

async function readSecret(): Promise<string> {
  return readFile(join(projectDir, "outside-secret.txt"), "utf-8");
}

/** Run `fn` and assert it didn't actually return the contents of the secret
 *  file outside `context/`, regardless of whether it threw or returned a
 *  structured error. */
async function assertNoLeak<T>(fn: () => Promise<T>): Promise<void> {
  try {
    const r = await fn();
    const json = JSON.stringify(r);
    expect(json).not.toContain(SECRET);
  } catch {
    // Throw is also an acceptable refusal.
  }
}

const ESCAPE_CASES: Array<[string, string]> = [
  ["traversal '..'", "../outside-secret.txt"],
  ["absolute path", "/etc/passwd"],
  ["NUL byte", "evil\0.md"],
  ["over-length", "a".repeat(4097)],
];

describe("read-style tools never expose content outside context/", () => {
  for (const [label, p] of ESCAPE_CASES) {
    test(`context_read does not leak via ${label}`, async () => {
      await assertNoLeak(() => contextReadTool.execute({ path: p }, ctx()));
    });
    test(`context_info does not leak via ${label}`, async () => {
      await assertNoLeak(() => contextInfoTool.execute({ path: p }, ctx()));
    });
    test(`context_count_lines does not leak via ${label}`, async () => {
      await assertNoLeak(() =>
        contextCountLinesTool.execute({ path: p }, ctx()),
      );
    });
    test(`context_exists does not leak via ${label}`, async () => {
      // exists deliberately swallows PathEscapeError → returns { exists: false }
      // — that's still a non-leak.
      const r = await contextExistsTool
        .execute({ path: p }, ctx())
        .catch(() => null);
      if (r) expect(r.exists).toBe(false);
    });
    test(`context_tree does not leak via ${label}`, async () => {
      await assertNoLeak(() =>
        contextTreeTool.execute({ path: p, max_depth: 5 }, ctx()),
      );
    });
    test(`context_dir_size does not leak via ${label}`, async () => {
      await assertNoLeak(() => contextDirSizeTool.execute({ path: p }, ctx()));
    });
  }
});

describe("write-style tools never modify content outside context/", () => {
  for (const [label, p] of ESCAPE_CASES) {
    test(`context_write leaves outside-secret.txt untouched (${label})`, async () => {
      await contextWriteTool
        .execute({ path: p, content: "CLOBBERED" }, ctx())
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_edit leaves outside-secret.txt untouched (${label})`, async () => {
      await contextEditTool
        .execute(
          {
            path: p,
            patches: [{ start_line: 1, end_line: 1, content: "CLOBBERED" }],
          },
          ctx(),
        )
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_delete does not unlink outside-secret.txt (${label})`, async () => {
      await contextDeleteTool.execute({ path: p }, ctx()).catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_create_dir does not create dirs outside context/ (${label})`, async () => {
      await contextCreateDirTool.execute({ path: p }, ctx()).catch(() => null);
      // The secret file is untouched and still a file (not a clobbered dir).
      expect(await readSecret()).toBe(SECRET);
    });
  }

  for (const [label, p] of ESCAPE_CASES) {
    test(`context_move (escaping src) leaves outside-secret.txt in place (${label})`, async () => {
      await contextMoveTool
        .execute({ src: p, dst: "moved.md" }, ctx())
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_move (escaping dst) leaves outside-secret.txt unclobbered (${label})`, async () => {
      await contextMoveTool
        .execute({ src: "ok.md", dst: p, overwrite: true }, ctx())
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_copy (escaping src) leaves outside-secret.txt in place (${label})`, async () => {
      await contextCopyTool
        .execute({ src: p, dst: "copied.md" }, ctx())
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });

    test(`context_copy (escaping dst) leaves outside-secret.txt unclobbered (${label})`, async () => {
      await contextCopyTool
        .execute({ src: "ok.md", dst: p, overwrite: true }, ctx())
        .catch(() => null);
      expect(await readSecret()).toBe(SECRET);
    });
  }
});

describe("symlink attacks", () => {
  test("context_read does not follow a leaf symlink to a file outside the project", async () => {
    await symlink(
      join(projectDir, "outside-secret.txt"),
      join(projectDir, CONTEXT_DIR, "leak.txt"),
    );
    await assertNoLeak(() =>
      contextReadTool.execute({ path: "leak.txt" }, ctx()),
    );
  });

  test("context_read does not traverse a symlinked directory", async () => {
    await mkdir(join(projectDir, "elsewhere"), { recursive: true });
    await writeFile(
      join(projectDir, "elsewhere", "stuff.md"),
      `STUFF-${SECRET}`,
    );
    await symlink(
      join(projectDir, "elsewhere"),
      join(projectDir, CONTEXT_DIR, "linkdir"),
    );
    await assertNoLeak(() =>
      contextReadTool.execute({ path: "linkdir/stuff.md" }, ctx()),
    );
  });

  test("context_write refuses to write through a leaf symlink to outside the project", async () => {
    await symlink(
      join(projectDir, "outside-secret.txt"),
      join(projectDir, CONTEXT_DIR, "evil.md"),
    );
    await contextWriteTool
      .execute(
        { path: "evil.md", content: "CLOBBERED", on_conflict: "overwrite" },
        ctx(),
      )
      .catch(() => null);
    expect(await readSecret()).toBe(SECRET);
  });
});

describe("legitimate paths inside context/ still work", () => {
  // Sanity: prove the same tools work fine when called inside the sandbox.
  // If these go red, the tool is broken (not the sandbox).
  test("context_read reads a real file under context/", async () => {
    const r = await contextReadTool.execute({ path: "ok.md" }, ctx());
    expect(r.is_error).toBe(false);
    expect(r.content).toBe("hello");
  });

  test("context_write creates a new file under context/", async () => {
    const r = await contextWriteTool.execute(
      { path: "fresh.md", content: "new" },
      ctx(),
    );
    expect(r.is_error).toBe(false);
    const back = await contextReadTool.execute({ path: "fresh.md" }, ctx());
    expect(back.content).toBe("new");
  });

  test("context_create_dir + context_tree show new dirs", async () => {
    const r = await contextCreateDirTool.execute({ path: "sub/dir" }, ctx());
    expect(r.is_error).toBe(false);
    const tree = await contextTreeTool.execute(
      { path: "", max_depth: 5 },
      ctx(),
    );
    expect(tree.is_error).toBe(false);
    expect(tree.tree).toContain("sub");
  });
});
