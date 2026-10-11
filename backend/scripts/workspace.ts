import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Who this checkout is, and what names and ports follow from that.
 *
 * Agent tooling — Orca, Conductor — gives every task its own git worktree, and a
 * developer running four of them is running four copies of a suite that all read
 * `DATABASE_URL_TEST` and all find the same `botholomew_test`. `buildTestUniverse`
 * opens with `clearDatabase()`, so the failure is not a slow query or a duplicate
 * key: one worktree truncates another's tables mid-run, and both suites fail
 * somewhere unrelated to what either was testing. Redis is the same story one
 * layer down — keryx namespaces resque as the constant `"resque"` and sessions as
 * `"session"`, so two workers on one Redis database pop each other's jobs.
 *
 * **Nothing here runs on the server.** This is read by `setup-workspace.ts` and by
 * its tests, and by nothing else. The server has no idea workspaces exist: the
 * setup script resolves these names once and writes them into `.env`, and from
 * then on `config/database.ts` reads a connection string exactly the way it always
 * has. A derivation that ran at every boot would be a rule with no visible value —
 * `psql $DATABASE_URL_TEST` would connect somewhere other than where the tests do.
 */

/** Longest slug ever appended. `botholomew_test_` + this stays inside Postgres's 63-byte identifier limit. */
const MAX_SLUG_LENGTH = 30;

/** Redis exposes 16 databases. 0 is development and 1 belongs to an unscoped checkout. */
const REDIS_WORKSPACE_DATABASES = 14;
const REDIS_FIRST_WORKSPACE_DATABASE = 2;

/** Where the e2e stack lands when no workspace has claimed a range. Never `bun dev`'s 8080/3000. */
export const DEFAULT_E2E_BACKEND_PORT = 8081;
export const DEFAULT_E2E_FRONTEND_PORT = 3001;
const E2E_PORT_SPREAD = 500;

/**
 * Reduce a string to a small non-negative integer, deterministically.
 *
 * FNV-1a, because re-running the setup script has to land on the same database and
 * the same ports it chose last time.
 * @param value - The string to hash.
 * @returns A non-negative 32-bit integer.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Make an arbitrary name safe to paste into a Postgres database name.
 * @param value - The raw name, from an environment variable or a directory.
 * @returns Lowercase, alphanumeric and underscores only, length-capped, or `""`.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/, "");
}

/**
 * Walk up from a directory until a `.git` entry appears.
 * @param from - Where to start; defaults to the current working directory.
 * @returns The checkout root, or `null` if there is no `.git` above `from`.
 */
function findCheckoutRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The slug identifying this checkout, or `""` for the primary one.
 *
 * `""` is not a failure — it is the answer for a plain clone, and it is what keeps
 * `botholomew_test` and `redis/1` meaning exactly what they have always meant.
 *
 * In order:
 * 1. `BOTHOLOMEW_WORKSPACE_ID` — the override. Set it *empty* to opt a worktree out
 *    and share the primary checkout's data; that is why this reads "was it set"
 *    rather than "is it truthy".
 * 2. `CONDUCTOR_WORKSPACE_NAME` — Conductor's own name for the workspace.
 * 3. `ORCA_WORKTREE_ID` — Orca's, which is `<uuid>::<path>`; the path's last
 *    segment is the branch-ish name a human recognizes, and the uuid is the
 *    fallback if that is somehow empty.
 * 4. The checkout itself. In a linked worktree `.git` is a *file* holding a
 *    `gitdir:` pointer, where in a primary checkout it is a directory — which is
 *    what lets this work when the setup script is run from a plain terminal that
 *    never saw Orca's or Conductor's environment.
 * @param from - Directory to search upwards from; defaults to the cwd.
 * @returns A Postgres-safe slug, or `""` for the primary checkout.
 */
export function workspaceSlug(from?: string): string {
  const override = process.env.BOTHOLOMEW_WORKSPACE_ID;
  if (override !== undefined) return slugify(override);

  const conductor = process.env.CONDUCTOR_WORKSPACE_NAME;
  if (conductor) return slugify(conductor);

  const orca = process.env.ORCA_WORKTREE_ID;
  if (orca) {
    const [uuid, path] = orca.split("::");
    const name = path ? basename(path) : "";
    return slugify(name || uuid || "");
  }

  const root = findCheckoutRoot(from);
  if (!root) return "";
  try {
    if (!statSync(join(root, ".git")).isFile()) return "";
  } catch {
    return "";
  }
  return slugify(basename(root));
}

/**
 * Give a workspace its own database, by name.
 * @param connectionString - The configured URL, e.g. `postgres://…/botholomew_test`.
 * @param slug - This workspace's slug; `""` leaves the URL alone.
 * @returns The URL with the slug appended to the database name.
 */
export function scopedDatabaseUrl(
  connectionString: string,
  slug: string,
): string {
  if (!slug) return connectionString;
  const url = new URL(connectionString);
  const name = url.pathname.replace(/^\//, "");
  if (!name) return connectionString;
  url.pathname = `/${name}_${slug}`;
  return url.toString();
}

/**
 * Give a workspace its own Redis database.
 *
 * A suffix is not an option here the way it is for Postgres: keryx hardcodes the
 * resque namespace and the session key prefix, so the *only* separation Redis
 * offers is the numbered database. There are 14 to hand out and a hash picks one,
 * which means two worktrees can still collide — far better than the certainty of
 * every worktree sharing database 1, and the setup script prints the number it
 * chose, so a collision is visible rather than mysterious.
 * @param connectionString - The configured URL, e.g. `redis://…/1`.
 * @param slug - This workspace's slug; `""` leaves the URL alone.
 * @returns The URL pointed at this workspace's database index.
 */
export function scopedRedisUrl(connectionString: string, slug: string): string {
  if (!slug) return connectionString;
  const url = new URL(connectionString);
  const index =
    REDIS_FIRST_WORKSPACE_DATABASE + (hash(slug) % REDIS_WORKSPACE_DATABASES);
  url.pathname = `/${index}`;
  return url.toString();
}

/**
 * The ports this workspace's e2e stack should bind.
 *
 * `CONDUCTOR_PORT` wins when Conductor set it: it is the first of a ten-port range
 * Conductor has actually reserved for this workspace, which beats any hash we
 * could compute. Offsets 0 and 1 are left for `bun dev`, so the e2e pair takes 2
 * and 3. Otherwise the offset comes from the slug, and an unscoped checkout takes
 * the defaults — which are still not 8080 and 3000, because a suite must never
 * take the ports a dev server is on.
 * @param slug - This workspace's slug; `""` yields the defaults.
 * @returns The backend and frontend ports for the e2e stack.
 */
export function workspacePorts(slug: string): {
  backend: number;
  frontend: number;
} {
  const conductorPort = Number(process.env.CONDUCTOR_PORT);
  if (conductorPort) {
    return { backend: conductorPort + 2, frontend: conductorPort + 3 };
  }
  const offset = slug ? hash(slug) % E2E_PORT_SPREAD : 0;
  return {
    backend: DEFAULT_E2E_BACKEND_PORT + offset,
    frontend: DEFAULT_E2E_FRONTEND_PORT + offset,
  };
}
