import { createHash } from "node:crypto";
import {
  copyFile as fsCopyFile,
  readFile as fsReadFile,
  rename as fsRename,
  lstat,
  mkdir,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { CONTEXT_DIR, PROTECTED_AREAS } from "../constants.ts";
import {
  atomicWrite,
  atomicWriteIfUnchanged,
  MtimeConflictError,
  readWithMtime,
} from "../fs/atomic.ts";
import { applyLinePatches, type LinePatch } from "../fs/patches.ts";
import {
  getCanonicalRoot,
  PathEscapeError,
  resolveInRoot,
  toRelativePath,
} from "../fs/sandbox.ts";
import { withContextLock } from "./locks.ts";

function defaultHolderId(): string {
  return `pid:${process.pid}`;
}

/**
 * Disk-backed replacement for the old DuckDB context_items CRUD layer. All
 * agent-writable content lives under `<projectDir>/context/`. Tools take a
 * project-relative path (e.g. `notes/foo.md`) that gets sandboxed against the
 * context root via `resolveInRoot`.
 *
 * The path argument convention everywhere in this file is forward-slash
 * relative-to-context (NOT absolute, NOT relative-to-project). Convert at
 * the boundary with `relativeFromContext`.
 */

export class NotFoundError extends Error {
  constructor(readonly path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}

export class IsDirectoryError extends Error {
  constructor(readonly path: string) {
    super(`Path is a directory: ${path}`);
    this.name = "IsDirectoryError";
  }
}

export class NotDirectoryError extends Error {
  constructor(readonly path: string) {
    super(`Path is not a directory: ${path}`);
    this.name = "NotDirectoryError";
  }
}

export class PathConflictError extends Error {
  constructor(readonly path: string) {
    super(`Path already exists: ${path}`);
    this.name = "PathConflictError";
  }
}

export type Patch = LinePatch;

export interface ContextEntry {
  /** Project-relative path under context/, e.g. "notes/foo.md". Forward-slashes. */
  path: string;
  is_directory: boolean;
  is_textual: boolean;
  /**
   * True when the entry's path under `context/` is a symlink (set from
   * `lstat`). The agent can read and delete the link, but writes that
   * traverse a symlink fail with PathEscapeError so external content is
   * never modified.
   */
  is_symlink: boolean;
  size: number;
  mime_type: string;
  mtime: Date;
  content_hash: string | null;
}

/** Hard cap on directory recursion across walks; defends against pathological symlink graphs. */
const MAX_WALK_DEPTH = 32;

const TEXTUAL_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "html",
  "htm",
  "xml",
  "csv",
  "tsv",
  "log",
  "rst",
  "org",
  "tex",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "proto",
]);

function inferMimeType(path: string): { mime: string; textual: boolean } {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") {
    return { mime: "text/markdown", textual: true };
  }
  if (ext === "json") return { mime: "application/json", textual: true };
  if (ext === "html" || ext === "htm")
    return { mime: "text/html", textual: true };
  if (ext === "csv") return { mime: "text/csv", textual: true };
  if (TEXTUAL_EXTENSIONS.has(ext))
    return { mime: `text/${ext}`, textual: true };
  return { mime: "application/octet-stream", textual: false };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function fromPosix(p: string): string {
  return p.split("/").join(sep);
}

/** Normalize a user-supplied path: trim leading slashes, collapse to forward slashes. */
export function normalizeContextPath(path: string): string {
  let p = (path ?? "").trim();
  // Strip a leading `/` so the path is unambiguously relative-to-context.
  while (p.startsWith("/")) p = p.slice(1);
  return toPosix(p);
}

/**
 * Resolve a context-relative path to an absolute filesystem path under
 * `<projectDir>/context/`. Throws PathEscapeError on traversal, NUL bytes,
 * or attempts to resolve into a protected area.
 *
 * `allowSymlinks` is the opt-in for read-side callers (read, list, tree,
 * info, reindex). Mutating callers (write, edit, mv, cp, mkdir) leave it
 * `false` so user-placed symlinks under `context/` cannot be traversed to
 * modify external content. `allowSymlinkLeaf` is the narrower opt-in for
 * `delete`: the leaf may be a symlink (so the agent can unlink it) but
 * parent components may not, so a delete cannot reach external content
 * through a symlinked parent directory.
 */
async function resolveContext(
  projectDir: string,
  path: string,
  opts: { allowSymlinks?: boolean; allowSymlinkLeaf?: boolean } = {},
): Promise<string> {
  const normalized = normalizeContextPath(path);
  if (PROTECTED_AREAS.has(normalized)) {
    throw new PathEscapeError(
      `path is in a protected area: ${normalized}`,
      normalized,
    );
  }
  return resolveInRoot(projectDir, fromPosix(normalized), {
    area: CONTEXT_DIR,
    allowSymlinks: opts.allowSymlinks,
    allowSymlinkLeaf: opts.allowSymlinkLeaf,
  });
}

async function hashFile(absolutePath: string): Promise<string> {
  const buf = await fsReadFile(absolutePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * The canonical (symlink-resolved) absolute path of `<projectDir>/context/`.
 * Always use this — not `getContextDir(projectDir)` — when computing relative
 * paths from absolute fs results, because macOS tmp dirs symlink
 * /var/folders → /private/var/folders and `resolveInRoot` returns the
 * canonical form.
 */
function canonicalContextRoot(projectDir: string): string {
  return join(getCanonicalRoot(projectDir), CONTEXT_DIR);
}

export async function fileExists(
  projectDir: string,
  path: string,
): Promise<boolean> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  try {
    await stat(abs);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function getInfo(
  projectDir: string,
  path: string,
): Promise<ContextEntry | null> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  let lst: Awaited<ReturnType<typeof lstat>>;
  try {
    lst = await lstat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const isSymlink = lst.isSymbolicLink();
  let st: Awaited<ReturnType<typeof stat>>;
  if (isSymlink) {
    try {
      st = await stat(abs);
    } catch (err) {
      // Broken symlink — surface as a zero-byte symlink entry.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          path: normalizeContextPath(path),
          is_directory: false,
          is_textual: false,
          is_symlink: true,
          size: 0,
          mime_type: "application/octet-stream",
          mtime: lst.mtime,
          content_hash: null,
        };
      }
      throw err;
    }
  } else {
    st = lst;
  }
  const normalized = normalizeContextPath(path);
  if (st.isDirectory()) {
    return {
      path: normalized,
      is_directory: true,
      is_textual: false,
      is_symlink: isSymlink,
      size: 0,
      mime_type: "inode/directory",
      mtime: st.mtime,
      content_hash: null,
    };
  }
  const { mime, textual } = inferMimeType(normalized);
  return {
    path: normalized,
    is_directory: false,
    is_textual: textual,
    is_symlink: isSymlink,
    size: st.size,
    mime_type: mime,
    mtime: st.mtime,
    content_hash: textual ? await hashFile(abs) : null,
  };
}

export async function readContextFile(
  projectDir: string,
  path: string,
): Promise<string> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(path));
    }
    throw err;
  }
  if (st.isDirectory()) {
    throw new IsDirectoryError(normalizeContextPath(path));
  }
  return fsReadFile(abs, "utf-8");
}

export async function writeContextFile(
  projectDir: string,
  path: string,
  content: string,
  opts: {
    onConflict?: "error" | "overwrite";
    holderId?: string;
  } = {},
): Promise<ContextEntry> {
  const abs = await resolveContext(projectDir, path);
  const normalized = normalizeContextPath(path);
  if (normalized === "" || normalized.endsWith("/")) {
    throw new PathEscapeError(
      `target must be a file path, not a directory: ${path}`,
      path,
    );
  }
  const conflict = opts.onConflict ?? "overwrite";
  return withContextLock(
    projectDir,
    normalized,
    opts.holderId ?? defaultHolderId(),
    async () => {
      let exists = false;
      try {
        const st = await stat(abs);
        if (st.isDirectory()) throw new IsDirectoryError(normalized);
        exists = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (exists && conflict === "error") {
        throw new PathConflictError(normalized);
      }
      await mkdir(dirname(abs), { recursive: true });
      await atomicWrite(abs, content);
      const entry = await getInfo(projectDir, normalized);
      if (!entry) throw new Error(`Wrote ${normalized} but could not stat`);
      return entry;
    },
  );
}

export async function deleteContextPath(
  projectDir: string,
  path: string,
  opts: { recursive?: boolean; holderId?: string } = {},
): Promise<{ removed: number; was_directory: boolean; was_symlink: boolean }> {
  const abs = await resolveContext(projectDir, path, {
    allowSymlinkLeaf: true,
  });
  const normalized = normalizeContextPath(path);
  if (normalized === "") {
    throw new PathEscapeError("refusing to delete the context root", path);
  }
  return withContextLock(
    projectDir,
    normalized,
    opts.holderId ?? defaultHolderId(),
    async () => {
      let lst: Awaited<ReturnType<typeof lstat>>;
      try {
        lst = await lstat(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new NotFoundError(normalized);
        }
        throw err;
      }
      // A symlink (to a file or a directory, broken or not) is removed with
      // a plain unlink — never follow into the target. This is what enforces
      // "the symlink can be deleted, but not the original content".
      if (lst.isSymbolicLink()) {
        await unlink(abs);
        return { removed: 1, was_directory: false, was_symlink: true };
      }
      if (lst.isDirectory()) {
        if (!opts.recursive) {
          throw new IsDirectoryError(normalized);
        }
        const removedPaths = await collectFiles(abs);
        await rm(abs, { recursive: true, force: false });
        return {
          removed: removedPaths.length,
          was_directory: true,
          was_symlink: false,
        };
      }
      await unlink(abs);
      return { removed: 1, was_directory: false, was_symlink: false };
    },
  );
}

export async function moveContextPath(
  projectDir: string,
  src: string,
  dst: string,
  opts: { holderId?: string } = {},
): Promise<void> {
  const srcAbs = await resolveContext(projectDir, src);
  const dstAbs = await resolveContext(projectDir, dst);
  const srcNorm = normalizeContextPath(src);
  const dstNorm = normalizeContextPath(dst);
  // Acquire both locks in a stable order to avoid AB/BA deadlocks between
  // concurrent moves that swap two paths. Sorted lexicographically.
  const [firstNorm, secondNorm] =
    srcNorm < dstNorm ? [srcNorm, dstNorm] : [dstNorm, srcNorm];
  const holder = opts.holderId ?? defaultHolderId();
  return withContextLock(projectDir, firstNorm, holder, () =>
    withContextLock(projectDir, secondNorm, holder, async () => {
      try {
        await stat(srcAbs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new NotFoundError(srcNorm);
        }
        throw err;
      }
      try {
        await stat(dstAbs);
        throw new PathConflictError(dstNorm);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await mkdir(dirname(dstAbs), { recursive: true });
      await fsRename(srcAbs, dstAbs);
    }),
  );
}

export async function copyContextPath(
  projectDir: string,
  src: string,
  dst: string,
): Promise<void> {
  const srcAbs = await resolveContext(projectDir, src);
  const dstAbs = await resolveContext(projectDir, dst);
  let srcSt: Awaited<ReturnType<typeof stat>>;
  try {
    srcSt = await stat(srcAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(src));
    }
    throw err;
  }
  if (srcSt.isDirectory()) {
    throw new IsDirectoryError(normalizeContextPath(src));
  }
  try {
    await stat(dstAbs);
    throw new PathConflictError(normalizeContextPath(dst));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(dstAbs), { recursive: true });
  await fsCopyFile(srcAbs, dstAbs);
}

export async function createContextDir(
  projectDir: string,
  path: string,
): Promise<void> {
  const abs = await resolveContext(projectDir, path);
  await mkdir(abs, { recursive: true });
}

export async function listContextDir(
  projectDir: string,
  path: string,
  opts: { recursive?: boolean } = {},
): Promise<ContextEntry[]> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(path));
    }
    throw err;
  }
  if (!st.isDirectory()) {
    throw new NotDirectoryError(normalizeContextPath(path));
  }
  const out: ContextEntry[] = [];
  const visited = new Set<string>();
  visited.add(`${st.dev}:${st.ino}`);
  await walk(
    abs,
    canonicalContextRoot(projectDir),
    opts.recursive ?? false,
    out,
    visited,
    0,
  );
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(
  dir: string,
  contextRoot: string,
  recursive: boolean,
  acc: ContextEntry[],
  visited: Set<string>,
  depth: number,
): Promise<void> {
  if (depth >= MAX_WALK_DEPTH) return;
  const names = await readdir(dir);
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const abs = join(dir, name);
    const rel = toPosix(relative(contextRoot, abs));
    const lst = await lstat(abs);
    const isSymlink = lst.isSymbolicLink();
    let st: Awaited<ReturnType<typeof stat>>;
    if (isSymlink) {
      try {
        st = await stat(abs);
      } catch (err) {
        // Broken symlink — surface as a zero-byte symlink leaf so the agent
        // can see and remove it, but don't try to recurse into it.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          acc.push({
            path: rel,
            is_directory: false,
            is_textual: false,
            is_symlink: true,
            size: 0,
            mime_type: "application/octet-stream",
            mtime: lst.mtime,
            content_hash: null,
          });
          continue;
        }
        throw err;
      }
    } else {
      st = lst;
    }
    if (st.isDirectory()) {
      acc.push({
        path: rel,
        is_directory: true,
        is_textual: false,
        is_symlink: isSymlink,
        size: 0,
        mime_type: "inode/directory",
        mtime: st.mtime,
        content_hash: null,
      });
      if (recursive) {
        const key = `${st.dev}:${st.ino}`;
        if (visited.has(key)) continue;
        visited.add(key);
        await walk(abs, contextRoot, recursive, acc, visited, depth + 1);
      }
    } else if (st.isFile()) {
      const { mime, textual } = inferMimeType(rel);
      acc.push({
        path: rel,
        is_directory: false,
        is_textual: textual,
        is_symlink: isSymlink,
        size: st.size,
        mime_type: mime,
        mtime: st.mtime,
        content_hash: textual ? await hashFile(abs) : null,
      });
    }
  }
}

/**
 * Collect all real file paths under `absDir`, following symlinks (including
 * symlinked directories) once each. Used for delete-count reporting and
 * `dirSizeBytes`. Symlinked entries are returned as the *symlink path*
 * relative to the walk root, not the resolved target — callers like the
 * delete reporter want the agent-visible path. Cycles are prevented via a
 * `dev:ino` visited set seeded with `absDir` itself.
 */
async function collectFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>();
  try {
    const rootSt = await stat(absDir);
    visited.add(`${rootSt.dev}:${rootSt.ino}`);
  } catch {
    return out;
  }
  async function recurse(d: string, depth: number): Promise<void> {
    if (depth >= MAX_WALK_DEPTH) return;
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(d, name);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(abs);
      } catch {
        // Broken symlink or permission issue — skip silently.
        continue;
      }
      if (st.isDirectory()) {
        const key = `${st.dev}:${st.ino}`;
        if (visited.has(key)) continue;
        visited.add(key);
        await recurse(abs, depth + 1);
      } else if (st.isFile()) {
        out.push(abs);
      }
    }
  }
  await recurse(absDir, 0);
  return out;
}

export interface TreeNode {
  name: string;
  path: string;
  is_directory: boolean;
  is_symlink?: boolean;
  size?: number;
  children?: TreeNode[];
}

export async function buildTree(
  projectDir: string,
  path: string,
  maxDepth = 16,
): Promise<TreeNode> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  const lst = await lstat(abs).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(path));
    }
    throw err;
  });
  const isSymlink = lst.isSymbolicLink();
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(path));
    }
    throw err;
  }
  const root = canonicalContextRoot(projectDir);
  const rel = abs === root ? "" : toPosix(relative(root, abs));
  const name = rel === "" ? "." : posix.basename(rel);
  if (!st.isDirectory()) {
    return {
      name,
      path: rel,
      is_directory: false,
      ...(isSymlink ? { is_symlink: true } : {}),
      size: st.size,
    };
  }
  const visited = new Set<string>();
  visited.add(`${st.dev}:${st.ino}`);
  return treeRecurse(abs, rel, name, root, maxDepth, visited, isSymlink);
}

async function treeRecurse(
  abs: string,
  rel: string,
  name: string,
  contextRoot: string,
  depthLeft: number,
  visited: Set<string>,
  isSymlink: boolean,
): Promise<TreeNode> {
  const node: TreeNode = {
    name,
    path: rel,
    is_directory: true,
    ...(isSymlink ? { is_symlink: true } : {}),
    children: [],
  };
  if (depthLeft <= 0) return node;
  let names: string[];
  try {
    names = await readdir(abs);
  } catch {
    return node;
  }
  names.sort((a, b) => a.localeCompare(b));
  const children = node.children ?? [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const childAbs = join(abs, name);
    const lst = await lstat(childAbs);
    const childIsSymlink = lst.isSymbolicLink();
    let childSt: Awaited<ReturnType<typeof stat>>;
    if (childIsSymlink) {
      try {
        childSt = await stat(childAbs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // Broken symlink — render as zero-byte leaf so it shows in the tree.
          children.push({
            name,
            path: toPosix(relative(contextRoot, childAbs)),
            is_directory: false,
            is_symlink: true,
            size: 0,
          });
          continue;
        }
        throw err;
      }
    } else {
      childSt = lst;
    }
    const childRel = toPosix(relative(contextRoot, childAbs));
    if (childSt.isDirectory()) {
      const key = `${childSt.dev}:${childSt.ino}`;
      if (visited.has(key)) {
        // Cycle — render as a stub directory with no children.
        children.push({
          name,
          path: childRel,
          is_directory: true,
          ...(childIsSymlink ? { is_symlink: true } : {}),
          children: [],
        });
        continue;
      }
      visited.add(key);
      children.push(
        await treeRecurse(
          childAbs,
          childRel,
          name,
          contextRoot,
          depthLeft - 1,
          visited,
          childIsSymlink,
        ),
      );
    } else if (childSt.isFile()) {
      children.push({
        name,
        path: childRel,
        is_directory: false,
        ...(childIsSymlink ? { is_symlink: true } : {}),
        size: childSt.size,
      });
    }
  }
  node.children = children;
  return node;
}

export async function dirSizeBytes(
  projectDir: string,
  path: string,
): Promise<{ files: number; bytes: number }> {
  const abs = await resolveContext(projectDir, path, { allowSymlinks: true });
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(path));
    }
    throw err;
  }
  if (!st.isDirectory()) {
    throw new NotDirectoryError(normalizeContextPath(path));
  }
  let bytes = 0;
  let files = 0;
  for (const f of await collectFiles(abs)) {
    const fst = await stat(f);
    bytes += fst.size;
    files++;
  }
  return { files, bytes };
}

export async function applyPatches(
  projectDir: string,
  path: string,
  patches: Patch[],
  opts: { holderId?: string } = {},
): Promise<{ applied: number; lines: number }> {
  const abs = await resolveContext(projectDir, path);
  const normalized = normalizeContextPath(path);
  const holder = opts.holderId ?? defaultHolderId();
  return withContextLock(projectDir, normalized, holder, async () => {
    const read = await readWithMtime(abs);
    if (!read) throw new NotFoundError(normalized);
    const newContent = applyLinePatches(read.content, patches);
    // The lock keeps other context tools out of this critical section, but
    // an external editor (vim, IDE) can still mutate the file in parallel.
    // The mtime guard catches that — agents and humans don't silently lose
    // edits to each other.
    await atomicWriteIfUnchanged(abs, newContent, read.mtimeMs);
    return { applied: patches.length, lines: newContent.split("\n").length };
  });
}

export { MtimeConflictError };

/**
 * Convert an absolute filesystem path back to a context-relative path. Used
 * when rendering search hits or worker output that originated in store.ts.
 */
export function relativeFromContext(
  projectDir: string,
  absolute: string,
): string {
  return toPosix(toRelativePath(projectDir, absolute, CONTEXT_DIR));
}
