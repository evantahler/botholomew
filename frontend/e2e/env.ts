import { join } from "node:path";
import { loadEnv } from "vite";

/**
 * The environment the e2e stack runs in, shared by `playwright.config.ts` (which
 * imposes it on the servers it spawns) and `global-setup.ts` (which waits for
 * them).
 *
 * **The backend runs as `NODE_ENV=test`.** That one choice is what puts the suite
 * in the normal test database rather than the one you are developing against:
 * `DATABASE_URL_TEST` and `REDIS_URL_TEST` select themselves through keryx's
 * `loadFromEnvIfSet`, which reads `${VAR}_${NODE_ENV}` before `${VAR}`. Neither
 * URL is named here on purpose — it would be a second copy of a value
 * `backend/.env` already owns, and the two would disagree the first time somebody
 * edited one of them. The suite and `bun test` land in the same place because they
 * are asking the same file the same question.
 *
 * The consequence worth knowing: `bun test` opens with `clearDatabase()`, so
 * running it *while* Playwright is running pulls the rug out. One suite at a time
 * per checkout — which is what `bun run workspace:setup` giving each checkout its
 * own database is for.
 *
 * What *is* set here is everything `NODE_ENV=test` would otherwise get wrong for a
 * browser-driven suite, and nothing else. Each is `_TEST`-suffixed, so it beats
 * `backend/.env` without editing it, and affects only the process Playwright
 * spawns — `bun test` in another terminal is untouched.
 */

// Playwright runs under node, so unlike the backend nothing has loaded `.env`
// into `process.env` for us. `loadEnv` with an empty prefix is how
// `vite.config.ts` already reads `PORT`, and it lets a real environment variable
// win over the file — which is how CI overrides these without editing anything.
//
// The directory is `frontend/`, **not this file's own**. `workspace:setup`
// writes the two ports into `frontend/.env`, and `import.meta.dirname` is
// `frontend/e2e`, where there is no `.env` at all. Reading the wrong directory
// is not an error: every checkout silently falls back to the 8081/3001
// defaults, so the per-workspace ports that exist precisely to stop worktrees
// colliding are never read, and two suites running at once fight over one pair
// of ports.
const env = loadEnv("development", join(import.meta.dirname, ".."), "");

// Written by `bun run workspace:setup`; absent until somebody runs it, and these
// defaults are deliberately not 8080/3000, so a suite never takes the ports out
// from under a running dev server.
export const BACKEND_PORT = Number(env.E2E_BACKEND_PORT) || 8081;
export const FRONTEND_PORT = Number(env.E2E_FRONTEND_PORT) || 3001;
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

/** What the backend is started with. See the note above on `NODE_ENV=test`. */
export const BACKEND_ENV: Record<string, string> = {
  NODE_ENV: "test",
  // `bun test` gives every file a random free port; a browser has to be told one
  // up front.
  WEB_SERVER_PORT_TEST: String(BACKEND_PORT),
  APPLICATION_URL_TEST: BACKEND_URL,
  // Must be the Vite dev server's origin or every request fails its CORS preflight.
  WEB_SERVER_ALLOWED_ORIGINS_TEST: FRONTEND_URL,
  // `.env` silences the backend to `fatal` under test, which is right for a
  // thousand-assertion unit suite and wrong here: a browser spec fails with a
  // screenshot of a page that did not change, and the server's account of why is
  // the other half of the story. `warn` rather than `info` so a green run stays
  // readable — the request log would be several hundred lines of noise — while
  // anything that actually went wrong still reaches the terminal. It only gets
  // there because `playwright.config.ts` pipes this server's stdout, which
  // Playwright otherwise discards.
  LOG_LEVEL_TEST: "warn",
  // Also off under test, and also wrong here. The limiter is real in production
  // and the browser path is the only place we exercise it, which is why
  // `.env.example` raises `RATE_LIMIT_UNAUTH_LIMIT` to 100 rather than dodging it.
  RATE_LIMIT_ENABLED_TEST: "true",
  // Nothing else migrates the test database before Playwright starts.
  DATABASE_AUTO_MIGRATE_TEST: "true",
  PROCESS_NAME_TEST: "botholomew-e2e",
};

/** What the Vite dev server is started with. */
export const FRONTEND_ENV: Record<string, string> = {
  PORT: String(FRONTEND_PORT),
  VITE_API_URL: BACKEND_URL,
};
