import { lstatSync, realpathSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";

const MAX_PATH_LENGTH = 4096;

export class PathEscapeError extends Error {
  constructor(
    message: string,
    readonly userPath: string,
    readonly resolvedPath?: string,
  ) {
    super(message);
    this.name = "PathEscapeError";
  }
}

export interface SandboxOptions {
  /**
   * Restrict the resolved path to a subtree of the root (e.g., "context").
   * The area is appended to the canonical root and used as the containment
   * boundary instead of the root itself.
   */
  area?: string;
  /**
   * Allow the resolved path to equal the root/area itself (for directory
   * operations like list/tree). Default true.
   */
  allowRoot?: boolean;
  /**
   * Permit user-placed symlinks anywhere along the resolved path. The
   * containment check on the user-supplied path is unchanged — only the
   * lstat-walk that rejects symlink components is skipped. Read-side
   * callers (read, list, tree, reindex) opt in; mutating callers do not,
   * so the agent can never write through a user symlink to external
   * content.
   */
  allowSymlinks?: boolean;
  /**
   * Permit a symlink only as the final path component. Parent components
   * are still lstat-walked and rejected if any is a symlink. This is the
   * mode for mutating callers that intentionally operate on a symlink
   * leaf (e.g., `deleteContextPath` unlinking a user-placed symlink) but
   * must not be coaxed into reaching outside content via a symlinked
   * parent directory.
   */
  allowSymlinkLeaf?: boolean;
}

let cachedCanonicalRoot: string | null = null;
let cachedRawRoot: string | null = null;

/**
 * Resolve the project root once at startup so all subsequent containment
 * checks compare against the canonical (symlink-followed) path. Idempotent
 * per root.
 */
export function setCanonicalRoot(rawRoot: string): string {
  if (cachedRawRoot === rawRoot && cachedCanonicalRoot) {
    return cachedCanonicalRoot;
  }
  const canonical = realpathSync(rawRoot);
  cachedRawRoot = rawRoot;
  cachedCanonicalRoot = canonical;
  return canonical;
}

export function getCanonicalRoot(rawRoot: string): string {
  if (cachedRawRoot === rawRoot && cachedCanonicalRoot) {
    return cachedCanonicalRoot;
  }
  return setCanonicalRoot(rawRoot);
}

/**
 * Resolve a user-supplied path against the project root with traversal and
 * symlink protection. Always use this for any path that an agent tool may
 * touch — never `path.resolve` directly.
 *
 * Rules:
 *  1. NUL bytes / overlong paths rejected.
 *  2. Input is NFC-normalized so macOS NFD-after-vim doesn't desync the index.
 *  3. After path.resolve, the result must be inside the (canonical) root or
 *     `<root>/<area>`.
 *  4. `..` components after normalization are rejected as defense in depth.
 *  5. Every existing path component is `lstat`'d; any symlink is rejected
 *     unless `allowSymlinks` is set (read-only callers opt in so users can
 *     symlink content into `<root>/context/`). Hardlinks are out of scope.
 *
 * Returns the absolute, canonical path safe to pass to fs APIs.
 */
export async function resolveInRoot(
  rawRoot: string,
  userPath: string,
  opts: SandboxOptions = {},
): Promise<string> {
  validateUserPath(userPath);
  const normalized = userPath.normalize("NFC");

  const canonicalRoot = getCanonicalRoot(rawRoot);
  const boundary = opts.area
    ? resolve(canonicalRoot, opts.area)
    : canonicalRoot;

  const resolved = resolve(boundary, normalized);
  ensureContainment(resolved, boundary, opts.allowRoot ?? true, userPath);

  if (!opts.allowSymlinks) {
    await assertNoSymlinkComponents(
      resolved,
      canonicalRoot,
      opts.allowSymlinkLeaf ?? false,
    );
  }
  return resolved;
}

/**
 * Synchronous variant for callers that can't use async (rare). Same semantics.
 */
export function resolveInRootSync(
  rawRoot: string,
  userPath: string,
  opts: SandboxOptions = {},
): string {
  validateUserPath(userPath);
  const normalized = userPath.normalize("NFC");

  const canonicalRoot = getCanonicalRoot(rawRoot);
  const boundary = opts.area
    ? resolve(canonicalRoot, opts.area)
    : canonicalRoot;

  const resolved = resolve(boundary, normalized);
  ensureContainment(resolved, boundary, opts.allowRoot ?? true, userPath);

  if (!opts.allowSymlinks) {
    assertNoSymlinkComponentsSync(
      resolved,
      canonicalRoot,
      opts.allowSymlinkLeaf ?? false,
    );
  }
  return resolved;
}

function validateUserPath(userPath: string): void {
  if (typeof userPath !== "string") {
    throw new PathEscapeError("path must be a string", String(userPath));
  }
  if (userPath.includes("\0")) {
    throw new PathEscapeError("path contains NUL byte", userPath);
  }
  if (userPath.length > MAX_PATH_LENGTH) {
    throw new PathEscapeError(
      `path exceeds maximum length (${MAX_PATH_LENGTH})`,
      userPath,
    );
  }
}

function ensureContainment(
  resolved: string,
  boundary: string,
  allowRoot: boolean,
  userPath: string,
): void {
  if (resolved === boundary) {
    if (!allowRoot) {
      throw new PathEscapeError(
        "path resolves to the area root",
        userPath,
        resolved,
      );
    }
    return;
  }
  if (!resolved.startsWith(boundary + sep)) {
    throw new PathEscapeError(
      `path escapes project root: ${userPath}`,
      userPath,
      resolved,
    );
  }
  // Defense in depth: even a successful prefix check shouldn't pass a `..`
  // segment after normalization. (path.resolve collapses these, but we double
  // check in case the normalize step introduces one.)
  const rel = resolved.slice(boundary.length + 1);
  if (rel.split(sep).some((seg) => seg === ".." || seg === "." || seg === "")) {
    throw new PathEscapeError(
      `path contains forbidden component: ${userPath}`,
      userPath,
      resolved,
    );
  }
}

async function assertNoSymlinkComponents(
  resolved: string,
  canonicalRoot: string,
  allowLeaf: boolean,
): Promise<void> {
  // Walk from canonical root toward the leaf, lstat'ing each existing
  // component. The root itself is canonical (already realpath'd) so we skip
  // it; we only care that nothing the agent writes goes through a symlink.
  // When `allowLeaf` is true, the final component may itself be a symlink
  // (e.g., delete unlinking a user-placed symlink) — only parents are checked.
  const rel = resolved.slice(canonicalRoot.length);
  if (!rel || rel === sep) return;
  const parts = rel.split(sep).filter((p) => p.length > 0);
  let current = canonicalRoot;
  for (let i = 0; i < parts.length; i++) {
    current = current + sep + parts[i];
    const isLeaf = i === parts.length - 1;
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink()) {
        if (isLeaf && allowLeaf) continue;
        throw new PathEscapeError(
          `path traverses a symlink: ${current}`,
          resolved,
          current,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Component doesn't exist yet — nothing to verify, and the create
        // call that follows will be performed within an already-vetted parent.
        return;
      }
      throw err;
    }
  }
}

function assertNoSymlinkComponentsSync(
  resolved: string,
  canonicalRoot: string,
  allowLeaf: boolean,
): void {
  const rel = resolved.slice(canonicalRoot.length);
  if (!rel || rel === sep) return;
  const parts = rel.split(sep).filter((p) => p.length > 0);
  let current = canonicalRoot;
  for (let i = 0; i < parts.length; i++) {
    current = current + sep + parts[i];
    const isLeaf = i === parts.length - 1;
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink()) {
        if (isLeaf && allowLeaf) continue;
        throw new PathEscapeError(
          `path traverses a symlink: ${current}`,
          resolved,
          current,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

/**
 * Convert an absolute resolved path back to a project-relative path (with
 * forward slashes, suitable for display and storage).
 */
export function toRelativePath(
  rawRoot: string,
  absolute: string,
  area?: string,
): string {
  const canonicalRoot = getCanonicalRoot(rawRoot);
  const boundary = area ? resolve(canonicalRoot, area) : canonicalRoot;
  if (absolute === boundary) return "";
  if (!absolute.startsWith(boundary + sep)) {
    throw new PathEscapeError(
      `path is outside ${area ?? "root"}`,
      absolute,
      absolute,
    );
  }
  return absolute
    .slice(boundary.length + 1)
    .split(sep)
    .join("/");
}

/**
 * Reject absolute paths and obvious traversal at the API boundary so error
 * messages are clear (vs. relying on the resolver to also catch them).
 */
export function assertRelative(userPath: string): void {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathEscapeError("path is required", String(userPath));
  }
  if (isAbsolute(userPath)) {
    throw new PathEscapeError(
      `path must be project-relative, not absolute: ${userPath}`,
      userPath,
    );
  }
  const norm = normalize(userPath);
  if (
    norm === ".." ||
    norm.startsWith(`..${sep}`) ||
    norm.includes(`${sep}..${sep}`)
  ) {
    throw new PathEscapeError(`path escapes project: ${userPath}`, userPath);
  }
}

/** For tests: clear cached canonical root so fresh setup() calls resolve fresh. */
export function _resetSandboxCacheForTests(): void {
  cachedCanonicalRoot = null;
  cachedRawRoot = null;
}
