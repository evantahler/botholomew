import { chromium, type FullConfig } from "@playwright/test";
import { BACKEND_URL } from "./env.ts";

/**
 * Wait until the backend has finished migrating its database.
 *
 * Playwright's `webServer.url` check answers this question wrong, and not by a
 * small margin: keryx binds the web server *before* `DATABASE_AUTO_MIGRATE` has
 * created a single table, so a readiness probe that only asks whether the port
 * is open releases the suite against an empty schema. Against a warm database
 * nobody notices; against a fresh one — every CI run, and the first run in a
 * new worktree, which now has a database of its own — the first specs race the
 * migration and fail on data that never arrived.
 *
 * `/api/status` is the probe: its database check touches
 * `audit_logs.actor_bot_id`, the newest column in the schema, so `healthy:
 * true` means the migrations landed and not just that Postgres answered
 * `SELECT NOW()`.
 * @throws {Error} If the schema has not appeared before the deadline.
 */
async function waitForMigrations(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/status`);
      if (response.ok) {
        const body = (await response.json()) as {
          healthy?: boolean;
          checks?: { database?: boolean };
        };
        if (body.healthy === true && body.checks?.database === true) return;
        lastError = `HTTP ${response.status}: not healthy yet (${JSON.stringify(body.checks)})`;
      } else {
        lastError = `HTTP ${response.status}: ${await response.text()}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `The e2e backend at ${BACKEND_URL} never finished migrating. Last response — ${lastError}`,
  );
}

/**
 * Wait for the backend's schema, then warm the Vite dev server, before any worker
 * runs. Both `webServer.url` checks report ready well before their server is, and
 * for unrelated reasons — see `waitForMigrations` above for the backend's.
 *
 * Playwright's `webServer.url` check is satisfied by `index.html`, which Vite
 * serves without having transformed a single module — so the *first* page load in
 * each worker pays for the whole module graph plus a Sass compile of
 * `theme.scss`, four times over, concurrently. That made otherwise-fast specs
 * (a full sign-up round trip takes ~1.6s warm) blow through assertion timeouts on
 * a cold run and pass on retry, which is exactly the shape of a flake nobody can
 * reproduce locally.
 *
 * Loading one real page here forces that compilation once, up front, on nobody's
 * clock.
 * @param config - The Playwright config, for `baseURL`.
 */
export default async function globalSetup(config: FullConfig) {
  await waitForMigrations();

  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A protected route, so the auth context, the router, and the app chrome all
    // compile too — not just the marketing page. It must be a route that
    // resolves to a page rather than a redirect, or this warms the redirect and
    // nothing behind it.
    await page.goto(`${baseURL}/settings`, { waitUntil: "networkidle" });
    await page.goto(`${baseURL}/style-guide`, { waitUntil: "networkidle" });
  } finally {
    await browser.close();
  }
}
