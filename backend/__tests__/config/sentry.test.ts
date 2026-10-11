import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sentryPlugin } from "@keryxjs/sentry";
import { api, config } from "keryx";
import { configPlugins } from "../../config/plugins";
import { HOOK_TIMEOUT } from "../setup";

describe("sentry plugin", () => {
  test("is registered at boot", () => {
    // Asserted against the config module, not `config.plugins`: Keryx reads
    // that array during initialize and the live `config` object is not a
    // mirror of the file before `api.start()`.
    expect(configPlugins).toEqual([sentryPlugin]);
  });
});

describe("sentry plugin — after boot", () => {
  beforeAll(async () => {
    await api.start();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await api.stop();
  }, HOOK_TIMEOUT);

  test("exposes a dark api.sentry namespace", () => {
    // The plugin enables itself when a DSN is present. Tests copy
    // `.env.example`, which leaves `SENTRY_DSN` empty and sets
    // `SENTRY_ENABLED_TEST=false` so a leaked developer DSN still stays dark.
    expect(config.sentry.enabled).toBe(false);
    expect(api.sentry.enabled).toBe(false);
    expect(api.sentry.captureException(new Error("test"))).toBeUndefined();
  });
});
