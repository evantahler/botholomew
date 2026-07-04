import { describe, expect, test } from "bun:test";
import { HOME_CONFIG_DIR } from "../../src/constants.ts";
import { pkg } from "../../src/pkg.ts";
import { updater } from "../../src/update/updater.ts";

// The self-update/version-check logic lives in the `upgradr` package (which
// owns its own logic tests). Here we only assert that our singleton is wired
// with the right project metadata — the values that would silently break the
// npm lookup, the release-asset URL, or the cache location if they regressed.
describe("updater singleton config", () => {
  const cfg = updater.config;

  test("points at the botholomew npm package and GitHub repo", () => {
    expect(cfg.packageName).toBe(pkg.name);
    expect(cfg.packageName).toBe("botholomew");
    expect(cfg.repo).toBe("evantahler/botholomew");
    expect(cfg.currentVersion).toBe(pkg.version);
  });

  test("release assets are prefixed `botholomew-` and cache lives in ~/.botholomew", () => {
    expect(cfg.binaryName).toBe("botholomew");
    expect(cfg.cliName).toBe("botholomew");
    expect(cfg.cacheDir).toBe(HOME_CONFIG_DIR);
  });

  test("uses the BOTHOLOMEW_NO_UPDATE_CHECK opt-out and upstream defaults", () => {
    expect(cfg.noUpdateCheckEnv).toBe("BOTHOLOMEW_NO_UPDATE_CHECK");
    expect(cfg.localDevEntry).toBe("src/cli.ts");
    expect(cfg.checkIntervalMs).toBe(24 * 60 * 60 * 1000);
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.backgroundSkipCommands).toEqual(["check-update", "upgrade"]);
  });
});
