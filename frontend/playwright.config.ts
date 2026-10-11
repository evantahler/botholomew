import { defineConfig, devices } from "@playwright/test";
import {
  BACKEND_ENV,
  BACKEND_URL,
  FRONTEND_ENV,
  FRONTEND_URL,
} from "./e2e/env.ts";

/**
 * E2E config. Playwright boots the *real* backend and the Vite dev server, so
 * these specs exercise the same cross-origin path a browser takes — which is
 * the only way to catch a CORS or `VITE_API_URL` regression.
 *
 * Runs locally via `bun run test:e2e` and in CI as the `E2E Test` job.
 */
export default defineConfig({
  testDir: "./e2e",
  // Wait out the backend's migrations and compile the dev-server module graph,
  // both once, before the workers start. See the file for why neither
  // `webServer.url` check is enough on its own.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // Two workers, not Playwright's default half-the-cores. Every worker is a whole
  // Chromium rendering an unminified dev bundle, and they share the box with the
  // Vite dev server and the backend. Oversubscribed, the browsers — not the
  // server — become the bottleneck: measured directly, four concurrent signups
  // answer in 166ms each, while four parallel *specs* took eight seconds to get
  // the same request sent. That looked like backend flake and was not.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // On CI also emit the HTML report, which the workflow uploads as an artifact
  // when the job fails.
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun run start",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/status`,
      // Playwright merges this over `process.env`, and Bun in turn prefers a real
      // environment variable to anything in `.env` — so these are the last word.
      env: BACKEND_ENV,
      // Playwright discards a web server's stdout by default, which would make
      // the backend's log level academic. `BACKEND_ENV` sets it to `warn` so what
      // arrives here is the server's side of a failure and nothing else.
      stdout: "pipe",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun run dev",
      url: FRONTEND_URL,
      // Vite's `loadEnv` lets `process.env` win over `.env`, for both the dev
      // server's own `PORT` and the `VITE_API_URL` it inlines into the bundle —
      // which has to name the e2e backend, not the one `bun dev` is serving.
      env: FRONTEND_ENV,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
