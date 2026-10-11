import { sentryPlugin } from "@keryxjs/sentry";
import type { KeryxPlugin } from "keryx";

/**
 * Framework plugins loaded at boot.
 *
 * `@keryxjs/sentry` is a no-op until `SENTRY_DSN` is set. A deployment that sets
 * one puts it on the `botholomew-shared` env var group, so the API and the
 * worker report into the same Sentry project; local development and `bun test`
 * leave it empty.
 */
export const configPlugins: KeryxPlugin[] = [sentryPlugin];
