import { loadFromEnvIfSet } from "keryx";

/**
 * Overrides for `@keryxjs/sentry`. The plugin fills in DSN, environment,
 * sample rate, metrics/logs toggles, and the rest from `SENTRY_*` env vars;
 * user values win. Staging enables metrics and leaves logs off.
 *
 * Per-action opt-out is `tracing = false` on the action class (our `status`
 * health check), not a config key here.
 *
 * `release` prefers `SENTRY_RELEASE` and otherwise uses Render's injected
 * `RENDER_GIT_COMMIT`, so events group by deploy without a second blueprint
 * key. Empty locally, where neither is set.
 */
export const configSentry = {
  release: await loadFromEnvIfSet(
    "SENTRY_RELEASE",
    process.env.RENDER_GIT_COMMIT ?? "",
  ),
};
