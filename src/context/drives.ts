/**
 * Drives name the origin of a context item. Every item lives at a
 * `(drive, path)` pair; the `drive:/path` string form is a display and CLI
 * convention (single column queries use the two columns directly).
 *
 * Built-in drives:
 *   disk       — local filesystem; path is the absolute filesystem path
 *   url        — generic HTTP(S) URL; path is the full URL
 *   agent      — agent-authored scratch; path is whatever the agent chose
 *   google-docs — Google Docs; path is `/<docId>`
 *   github     — GitHub content; path is `/<owner>/<repo>/<rest>`
 */

export const BUILT_IN_DRIVES = [
  "disk",
  "url",
  "agent",
  "google-docs",
  "github",
] as const;

export interface DriveTarget {
  drive: string;
  path: string;
}

/** Parse `drive:/path` → `{ drive, path }`. Returns null if not in drive form. */
export function parseDriveRef(ref: string): DriveTarget | null {
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  const drive = ref.slice(0, i);
  const path = ref.slice(i + 1);
  if (!path.startsWith("/")) return null;
  if (!/^[a-z][a-z0-9_-]*$/.test(drive)) return null;
  return { drive, path };
}

/** Format a `(drive, path)` pair for display / CLI. */
export function formatDriveRef(target: DriveTarget): string {
  return `${target.drive}:${target.path}`;
}

/**
 * Detect the right drive for a URL. If `mcpxServerName` is provided, prefer it
 * as a hint (some MCP servers are named after the service they back).
 */
export function detectDriveFromUrl(
  url: string,
  mcpxServerName?: string | null,
): DriveTarget {
  const hint = mcpxServerName?.toLowerCase() ?? "";
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return { drive: "url", path: `/${url}` };
  }

  const host = parsed.hostname.toLowerCase();

  if (
    host === "docs.google.com" ||
    (hint.includes("google") && hint.includes("doc"))
  ) {
    const docId = extractGoogleDocId(parsed);
    if (docId) return { drive: "google-docs", path: `/${docId}` };
  }

  if (
    host === "github.com" ||
    host === "raw.githubusercontent.com" ||
    hint.includes("github")
  ) {
    const ghPath = extractGithubPath(parsed);
    if (ghPath) return { drive: "github", path: ghPath };
  }

  return { drive: "url", path: `/${url}` };
}

function extractGoogleDocId(u: URL): string | null {
  // https://docs.google.com/document/d/<docId>/edit
  // https://docs.google.com/spreadsheets/d/<docId>/edit
  const m = u.pathname.match(/\/d\/([^/]+)/);
  return m?.[1] ?? null;
}

function extractGithubPath(u: URL): string | null {
  // https://github.com/<owner>/<repo>/blob/<ref>/<path...>
  // https://github.com/<owner>/<repo>/tree/<ref>/<path...>
  // https://github.com/<owner>/<repo>
  // https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const [owner, repo, kind, _ref, ...rest] = segs;
  if (!owner || !repo) return null;
  if (u.hostname === "raw.githubusercontent.com") {
    // segs: owner, repo, ref, ...rest
    const [_o, _r, _f, ...raw] = segs;
    return raw.length > 0
      ? `/${owner}/${repo}/${raw.join("/")}`
      : `/${owner}/${repo}`;
  }
  if (kind === "blob" || kind === "tree") {
    return rest.length > 0
      ? `/${owner}/${repo}/${rest.join("/")}`
      : `/${owner}/${repo}`;
  }
  return `/${owner}/${repo}`;
}
