/**
 * Set this checkout up to run its tests without colliding with any other checkout,
 * then say exactly what it did.
 *
 * Optional, and run once when a workspace is created — from Orca's or Conductor's
 * setup script, or by hand. Skipping it leaves a checkout on `botholomew_test`,
 * `redis/1`, and the default e2e ports, which is correct for anyone with a single
 * clone. Running it gives *this* checkout its own database, its own Redis index,
 * and its own e2e ports.
 *
 * It resolves those names once and writes them into `.env`, rather than teaching
 * the server to derive them at boot. That is the whole design: after this runs,
 * `DATABASE_URL_TEST` says where the tests go, and `psql $DATABASE_URL_TEST` lands
 * in the same place they do. A rule applied invisibly at every boot would break
 * that correspondence for every tool that is not the server.
 *
 * Idempotent. It never drops a database and never rewrites a line it did not put
 * there.
 *
 *   bun run workspace:setup              # derive the id from Orca, Conductor, or git
 *   bun run workspace:setup --id my-name # name it explicitly
 *   bun run workspace:setup --shared     # opt out: share the primary checkout's data
 *   bun run workspace:setup --dry-run    # print the plan, touch nothing
 *
 * The id it settles on is written back as `BOTHOLOMEW_WORKSPACE_ID`, which pins it:
 * a second run reads that rather than re-deriving, so the answer cannot drift if
 * Orca relaunches the workspace or somebody renames the directory. It is also what
 * makes changing the id safe — the previous one is stripped before the new one is
 * applied, where a blind re-suffix would grow `botholomew_test_a` into
 * `botholomew_test_a_b`.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  scopedDatabaseUrl,
  scopedRedisUrl,
  workspacePorts,
  workspaceSlug,
} from "./workspace";

const BACKEND_DIR = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "..");
const FRONTEND_DIR = resolve(BACKEND_DIR, "../frontend");

const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shared = args.includes("--shared");
const idFlag = args.indexOf("--id");
const idValue = idFlag === -1 ? undefined : args[idFlag + 1];
// `--id` with nothing after it, or with the next flag after it, is a mistake
// rather than a request to name the workspace `--dry-run`. `--shared` is the way
// to ask for no scoping, because an empty argument does not survive being
// forwarded through `bun run`.
if (idFlag !== -1 && (idValue === undefined || idValue.startsWith("--"))) {
  console.error("--id needs a name. To opt out of scoping, use --shared.");
  process.exit(1);
}

/**
 * Read a key out of a `.env` file.
 * @param body - The file's contents.
 * @param key - The variable name.
 * @returns The value with any surrounding quotes removed, or `undefined`.
 */
function readEnvValue(body: string, key: string): string | undefined {
  const match = body.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

/**
 * Set a key in a `.env` file, replacing the line if it is already there and
 * appending it if it is not.
 * @param body - The file's contents.
 * @param key - The variable name.
 * @param value - The value to write, quoted.
 * @returns The updated contents.
 */
function writeEnvValue(body: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(body)) return body.replace(pattern, line);
  return `${body.endsWith("\n") ? body : `${body}\n`}${line}\n`;
}

/**
 * Make sure a workspace has a `.env` to edit, copying `.env.example` if not.
 * @param dir - The workspace directory.
 * @returns The path to its `.env`.
 */
function ensureEnvFile(dir: string): string {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) {
    if (dryRun) return envPath;
    copyFileSync(join(dir, ".env.example"), envPath);
    console.log(`created  ${envPath} from .env.example`);
  }
  return envPath;
}

/**
 * Apply a set of key/value pairs to a `.env`, reporting only what changed.
 * @param envPath - The file to edit.
 * @param values - The keys to set.
 */
function patchEnvFile(envPath: string, values: Record<string, string>): void {
  const body = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  let updated = body;
  for (const [key, value] of Object.entries(values)) {
    const current = readEnvValue(updated, key);
    console.log(
      current === value ? `  ${key}=${value} (unchanged)` : `  ${key}=${value}`,
    );
    updated = writeEnvValue(updated, key, value);
  }
  if (!dryRun && updated !== body) writeFileSync(envPath, updated);
}

/**
 * Create a database if it is not already there.
 * @param url - The URL of the database to create.
 * @returns What happened, for printing.
 */
async function ensureDatabase(url: string): Promise<string> {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  parsed.pathname = "/postgres";

  if (dryRun) return `would ensure ${name}`;

  const sql = new Bun.SQL(parsed.toString());
  try {
    const existing = await sql`
      select 1 from pg_database where datname = ${name}
    `;
    if (existing.length > 0) return `exists  ${name}`;
    // An identifier cannot be a bind parameter. `name` comes from `slugify`,
    // which permits only [a-z0-9_].
    await sql.unsafe(`create database "${name}"`);
    return `created ${name}`;
  } finally {
    await sql.end();
  }
}

const backendEnvPath = ensureEnvFile(BACKEND_DIR);
const frontendEnvPath = ensureEnvFile(FRONTEND_DIR);
const backendEnv = existsSync(backendEnvPath)
  ? readFileSync(backendEnvPath, "utf8")
  : "";

// Scope whatever this checkout is already configured with, rather than a
// hardcoded default — a developer who moved Postgres to another host keeps it.
const developmentUrl =
  readEnvValue(backendEnv, "DATABASE_URL") ??
  "postgres://localhost:5432/botholomew";
const testUrlBase =
  readEnvValue(backendEnv, "DATABASE_URL_TEST") ??
  "postgres://localhost:5432/botholomew_test";
const redisBase =
  readEnvValue(backendEnv, "REDIS_URL_TEST") ?? "redis://localhost:6379/1";

// What a previous run pinned, which is both the default for this run and the
// suffix to peel off before applying a new one.
const pinned = readEnvValue(backendEnv, "BOTHOLOMEW_WORKSPACE_ID");

let slug: string;
if (shared) {
  slug = "";
} else if (idValue !== undefined) {
  process.env.BOTHOLOMEW_WORKSPACE_ID = idValue;
  slug = workspaceSlug(BACKEND_DIR);
} else if (pinned !== undefined) {
  slug = pinned;
} else {
  slug = workspaceSlug(BACKEND_DIR);
}

// Re-running must be a no-op and re-naming must not compound, so the *previous*
// suffix comes off before this one goes on.
const unscopedTestUrl = pinned
  ? testUrlBase.replace(new RegExp(`_${pinned}$`), "")
  : testUrlBase;

const testUrl = scopedDatabaseUrl(unscopedTestUrl, slug);
const redisUrl = scopedRedisUrl(redisBase, slug);
const ports = workspacePorts(slug);

console.log(
  slug
    ? `workspace "${slug}" — its own test database, Redis index, and e2e ports`
    : "no workspace id — the shared test database, Redis index, and default e2e ports",
);
if (dryRun) console.log("(dry run — nothing will be written)");

console.log(`\n${backendEnvPath}`);
patchEnvFile(backendEnvPath, {
  // Pinned, so the next run reads this rather than re-deriving, and knows what to
  // strip if the id changes. Nothing on the server reads it.
  BOTHOLOMEW_WORKSPACE_ID: slug,
  DATABASE_URL_TEST: testUrl,
  REDIS_URL_TEST: redisUrl,
});

console.log(`\n${frontendEnvPath}`);
patchEnvFile(frontendEnvPath, {
  E2E_BACKEND_PORT: String(ports.backend),
  E2E_FRONTEND_PORT: String(ports.frontend),
});

console.log("\ndatabases");
for (const url of [developmentUrl, testUrl]) {
  try {
    console.log(`  ${await ensureDatabase(url)}`);
  } catch (error) {
    console.error(
      `  failed  ${url} — ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}
