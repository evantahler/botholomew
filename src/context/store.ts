import { createHash } from "node:crypto";
import {
  copyFile as fsCopyFile,
  readFile as fsReadFile,
  rename as fsRename,
  mkdir,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { CONTEXT_DIR, PROTECTED_AREAS } from "../constants.ts";
import { atomicWrite } from "../fs/atomic.ts";
import {
  getCanonicalRoot,
  PathEscapeError,
  resolveInRoot,
  toRelativePath,
} from "../fs/sandbox.ts";

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

export interface Patch {
  start_line: number;
  end_line: number;
  content: string;
}

export interface ContextEntry {
  /** Project-relative path under context/, e.g. "notes/foo.md". Forward-slashes. */
  path: string;
  is_directory: boolean;
  is_textual: boolean;
  size: number;
  mime_type: string;
  mtime: Date;
  content_hash: string | null;
}

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
 * `<projectDir>/context/`. Throws PathEscapeError on traversal, symlinks,
 * NUL bytes, or attempts to resolve into a protected area.
 */
async function resolveContext(
  projectDir: string,
  path: string,
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
  const abs = await resolveContext(projectDir, path);
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
  const abs = await resolveContext(projectDir, path);
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const normalized = normalizeContextPath(path);
  if (st.isDirectory()) {
    return {
      path: normalized,
      is_directory: true,
      is_textual: false,
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
  const abs = await resolveContext(projectDir, path);
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
  opts: { onConflict?: "error" | "overwrite" } = {},
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
}

export async function deleteContextPath(
  projectDir: string,
  path: string,
  opts: { recursive?: boolean } = {},
): Promise<{ removed: number; was_directory: boolean }> {
  const abs = await resolveContext(projectDir, path);
  const normalized = normalizeContextPath(path);
  if (normalized === "") {
    throw new PathEscapeError("refusing to delete the context root", path);
  }
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalized);
    }
    throw err;
  }
  if (st.isDirectory()) {
    if (!opts.recursive) {
      throw new IsDirectoryError(normalized);
    }
    const removedPaths = await collectFiles(abs);
    await rm(abs, { recursive: true, force: false });
    return { removed: removedPaths.length, was_directory: true };
  }
  await unlink(abs);
  return { removed: 1, was_directory: false };
}

export async function moveContextPath(
  projectDir: string,
  src: string,
  dst: string,
): Promise<void> {
  const srcAbs = await resolveContext(projectDir, src);
  const dstAbs = await resolveContext(projectDir, dst);
  try {
    await stat(srcAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(normalizeContextPath(src));
    }
    throw err;
  }
  try {
    await stat(dstAbs);
    throw new PathConflictError(normalizeContextPath(dst));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(dstAbs), { recursive: true });
  await fsRename(srcAbs, dstAbs);
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
  const abs = await resolveContext(projectDir, path);
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
  await walk(
    abs,
    canonicalContextRoot(projectDir),
    opts.recursive ?? false,
    out,
  );
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(
  dir: string,
  contextRoot: string,
  recursive: boolean,
  acc: ContextEntry[],
): Promise<void> {
  const names = await readdir(dir);
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const abs = join(dir, name);
    const rel = toPosix(relative(contextRoot, abs));
    const { lstat } = await import("node:fs/promises");
    const st = await lstat(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      acc.push({
        path: rel,
        is_directory: true,
        is_textual: false,
        size: 0,
        mime_type: "inode/directory",
        mtime: st.mtime,
        content_hash: null,
      });
      if (recursive) {
        await walk(abs, contextRoot, recursive, acc);
      }
    } else if (st.isFile()) {
      const { mime, textual } = inferMimeType(rel);
      acc.push({
        path: rel,
        is_directory: false,
        is_textual: textual,
        size: st.size,
        mime_type: mime,
        mtime: st.mtime,
        content_hash: textual ? await hashFile(abs) : null,
      });
    }
  }
}

async function collectFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  const { lstat } = await import("node:fs/promises");
  async function recurse(d: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(d, name);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) await recurse(abs);
      else if (st.isFile()) out.push(abs);
    }
  }
  await recurse(absDir);
  return out;
}

export interface TreeNode {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  children?: TreeNode[];
}

export async function buildTree(
  projectDir: string,
  path: string,
  maxDepth = 16,
): Promise<TreeNode> {
  const abs = await resolveContext(projectDir, path);
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
      size: st.size,
    };
  }
  return treeRecurse(abs, rel, name, root, maxDepth);
}

async function treeRecurse(
  abs: string,
  rel: string,
  name: string,
  contextRoot: string,
  depthLeft: number,
): Promise<TreeNode> {
  const node: TreeNode = {
    name,
    path: rel,
    is_directory: true,
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
  const { lstat } = await import("node:fs/promises");
  const children = node.children ?? [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const childAbs = join(abs, name);
    const st = await lstat(childAbs);
    if (st.isSymbolicLink()) continue;
    const childRel = toPosix(relative(contextRoot, childAbs));
    if (st.isDirectory()) {
      children.push(
        await treeRecurse(childAbs, childRel, name, contextRoot, depthLeft - 1),
      );
    } else if (st.isFile()) {
      children.push({
        name,
        path: childRel,
        is_directory: false,
        size: st.size,
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
  const abs = await resolveContext(projectDir, path);
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
): Promise<{ applied: number; lines: number }> {
  const content = await readContextFile(projectDir, path);
  const lines = content.split("\n");

  const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

  for (const patch of sorted) {
    if (patch.end_line === 0) {
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, 0, ...insertLines);
    } else {
      const deleteCount = patch.end_line - patch.start_line + 1;
      const insertLines = patch.content === "" ? [] : patch.content.split("\n");
      lines.splice(patch.start_line - 1, deleteCount, ...insertLines);
    }
  }

  const newContent = lines.join("\n");
  await writeContextFile(projectDir, path, newContent, {
    onConflict: "overwrite",
  });
  return { applied: patches.length, lines: lines.length };
}

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
