import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  _resetSandboxCacheForTests,
  assertRelative,
  PathEscapeError,
  resolveInRoot,
  resolveInRootSync,
  toRelativePath,
} from "../../src/fs/sandbox.ts";

let root: string;
// The sandbox canonicalizes via realpath at startup (so e.g. macOS
// /var/folders/... becomes /private/var/folders/...). Tests that compare
// returned paths use this canonical form.
let canonicalRoot: string;

beforeEach(async () => {
  _resetSandboxCacheForTests();
  root = await mkdtemp(join(tmpdir(), "both-sandbox-"));
  canonicalRoot = realpathSync(root);
  await mkdir(join(root, "context"), { recursive: true });
});

afterEach(async () => {
  _resetSandboxCacheForTests();
  await rm(root, { recursive: true, force: true });
});

describe("resolveInRoot — happy path", () => {
  test("plain relative path resolves under <root>/<area>", async () => {
    const out = await resolveInRoot(root, "notes/foo.md", { area: "context" });
    expect(out).toBe(join(canonicalRoot, "context", "notes", "foo.md"));
  });

  test("empty path resolves to area root when allowRoot is true (default)", async () => {
    const out = await resolveInRoot(root, "", { area: "context" });
    expect(out).toBe(join(canonicalRoot, "context"));
  });

  test("'.' resolves to area root", async () => {
    const out = await resolveInRoot(root, ".", { area: "context" });
    expect(out).toBe(join(canonicalRoot, "context"));
  });

  test("with no area, paths resolve under the project root", async () => {
    const out = await resolveInRoot(root, "tasks/abc.md");
    expect(out).toBe(join(canonicalRoot, "tasks", "abc.md"));
  });

  test("nested non-existing paths still resolve (caller will create them)", async () => {
    const out = await resolveInRoot(root, "deep/nested/new/file.md", {
      area: "context",
    });
    expect(out).toBe(
      join(canonicalRoot, "context", "deep", "nested", "new", "file.md"),
    );
  });
});

describe("resolveInRoot — traversal attacks", () => {
  test("'..' is rejected", async () => {
    await expect(
      resolveInRoot(root, "../escape.md", { area: "context" }),
    ).rejects.toThrow(PathEscapeError);
  });

  test("'a/../../escape' is rejected even though it normalizes inside-then-out", async () => {
    await expect(
      resolveInRoot(root, "a/../../escape.md", { area: "context" }),
    ).rejects.toThrow(PathEscapeError);
  });

  test("absolute paths are rejected by the area boundary check", async () => {
    // path.resolve("/etc/passwd") ignores the boundary, so the containment
    // check has to catch it.
    await expect(
      resolveInRoot(root, "/etc/passwd", { area: "context" }),
    ).rejects.toThrow(PathEscapeError);
  });

  test("a path that escapes the area but stays inside the root is rejected", async () => {
    // tasks/ is under root but outside context/ — must be rejected when the
    // area is pinned to "context".
    await expect(
      resolveInRoot(root, "../tasks/x.md", { area: "context" }),
    ).rejects.toThrow(PathEscapeError);
  });

  test("allowRoot=false rejects bare area-root paths", async () => {
    await expect(
      resolveInRoot(root, "", { area: "context", allowRoot: false }),
    ).rejects.toThrow(PathEscapeError);
  });
});

describe("resolveInRoot — input validation", () => {
  test("NUL byte is rejected", async () => {
    await expect(
      resolveInRoot(root, "evil\0.md", { area: "context" }),
    ).rejects.toThrow(/NUL/);
  });

  test("paths over 4096 chars are rejected", async () => {
    const tooLong = "a".repeat(4097);
    await expect(
      resolveInRoot(root, tooLong, { area: "context" }),
    ).rejects.toThrow(/maximum length/);
  });

  test("non-string input is rejected", async () => {
    // The sandbox is called from typed code, but defense in depth — make sure
    // a runtime non-string doesn't slip past.
    await expect(
      resolveInRoot(root, 42 as unknown as string, { area: "context" }),
    ).rejects.toThrow(PathEscapeError);
  });
});

describe("resolveInRoot — NFC/NFD normalization", () => {
  test("NFD input normalizes to NFC so vim-on-macOS round-trips", async () => {
    // "café" — NFD ('cafe' + combining acute) vs NFC ('café' single codepoint).
    const nfd = "café.md";
    const nfc = "café.md";
    expect(nfd).not.toBe(nfc);

    const a = await resolveInRoot(root, nfd, { area: "context" });
    const b = await resolveInRoot(root, nfc, { area: "context" });
    expect(a).toBe(b);
  });
});

describe("resolveInRoot — symlink rejection", () => {
  test("symlink at the leaf is rejected", async () => {
    const ctx = join(root, "context");
    await writeFile(join(root, "outside-secret.txt"), "secret");
    await symlink(join(root, "outside-secret.txt"), join(ctx, "link.txt"));
    await expect(
      resolveInRoot(root, "link.txt", { area: "context" }),
    ).rejects.toThrow(/symlink/);
  });

  test("symlink at an intermediate component is rejected", async () => {
    const ctx = join(root, "context");
    await mkdir(join(root, "elsewhere"), { recursive: true });
    await writeFile(join(root, "elsewhere", "file.md"), "hi");
    await symlink(join(root, "elsewhere"), join(ctx, "linked-dir"));
    await expect(
      resolveInRoot(root, "linked-dir/file.md", { area: "context" }),
    ).rejects.toThrow(/symlink/);
  });

  test("non-existing leaf under a real parent is allowed (write-new path)", async () => {
    // The agent should be able to write a new file: the parent exists and is
    // not a symlink, the leaf doesn't exist yet.
    const out = await resolveInRoot(root, "fresh.md", { area: "context" });
    expect(out).toBe(join(canonicalRoot, "context", "fresh.md"));
  });

  test("root that itself is a symlink is canonicalized once at startup", async () => {
    _resetSandboxCacheForTests();
    const realRoot = await mkdtemp(join(tmpdir(), "both-sandbox-real-"));
    const canonicalReal = realpathSync(realRoot);
    await mkdir(join(realRoot, "context"), { recursive: true });
    const linkRoot = join(tmpdir(), `both-sandbox-link-${Date.now()}`);
    await symlink(realRoot, linkRoot);
    try {
      const out = await resolveInRoot(linkRoot, "x.md", { area: "context" });
      // The returned path uses the canonical (real) root, not the symlinked one.
      expect(out.startsWith(`${canonicalReal}${sep}context${sep}`)).toBe(true);
    } finally {
      await rm(linkRoot, { force: true });
      await rm(realRoot, { recursive: true, force: true });
      _resetSandboxCacheForTests();
    }
  });
});

describe("resolveInRootSync", () => {
  test("matches the async behavior on the happy path", () => {
    const out = resolveInRootSync(root, "notes/foo.md", { area: "context" });
    expect(out).toBe(join(canonicalRoot, "context", "notes", "foo.md"));
  });

  test("rejects '..' synchronously", () => {
    expect(() =>
      resolveInRootSync(root, "../escape.md", { area: "context" }),
    ).toThrow(PathEscapeError);
  });
});

describe("toRelativePath", () => {
  // toRelativePath compares against the canonical root, so the absolute input
  // we pass in must be under that same canonical path — which is what
  // resolveInRoot returns and what real callers use.
  test("returns the project-relative slug for an absolute resolved path", () => {
    const abs = join(canonicalRoot, "context", "notes", "x.md");
    expect(toRelativePath(root, abs, "context")).toBe("notes/x.md");
  });

  test("uses forward slashes regardless of platform separator", () => {
    const abs = join(canonicalRoot, "context", "a", "b", "c.md");
    expect(toRelativePath(root, abs, "context")).toBe("a/b/c.md");
  });

  test("returns '' when the absolute path equals the area root", () => {
    expect(
      toRelativePath(root, join(canonicalRoot, "context"), "context"),
    ).toBe("");
  });

  test("throws when the absolute path is outside the area", () => {
    expect(() =>
      toRelativePath(root, join(canonicalRoot, "tasks", "x.md"), "context"),
    ).toThrow(PathEscapeError);
  });
});

describe("assertRelative", () => {
  test("accepts plain relative paths", () => {
    expect(() => assertRelative("notes/foo.md")).not.toThrow();
    expect(() => assertRelative("a/b/c.md")).not.toThrow();
  });

  test("rejects empty strings", () => {
    expect(() => assertRelative("")).toThrow(PathEscapeError);
  });

  test("rejects absolute paths", () => {
    expect(() => assertRelative("/etc/passwd")).toThrow(/absolute/);
  });

  test("rejects '..' that escapes the project", () => {
    expect(() => assertRelative("..")).toThrow(/escapes/);
    expect(() => assertRelative("../escape.md")).toThrow(/escapes/);
    expect(() => assertRelative("a/../../escape.md")).toThrow(/escapes/);
  });

  test("accepts internal '..' that normalizes back inside the tree", () => {
    // `a/../b` collapses to `b` — still inside the project. Defense-in-depth
    // resolution downstream catches anything that *actually* escapes; we
    // don't need to over-reject at this layer.
    expect(() => assertRelative("a/../b")).not.toThrow();
  });
});
