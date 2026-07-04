import { describe, expect, test } from "bun:test";
import { resolveUpgradeTarget } from "../../src/commands/upgrade.ts";
import type { UpdateCache, UpdateInfo } from "../../src/update/checker.ts";

describe("resolveUpgradeTarget", () => {
  test("always performs a fresh check (never trusts the cache)", async () => {
    let checkedWith: string | undefined;
    const check = async (currentVersion: string): Promise<UpdateInfo> => {
      checkedWith = currentVersion;
      return {
        currentVersion,
        latestVersion: "9.9.9",
        hasUpdate: true,
        aheadOfLatest: false,
        changelog: "## v9.9.9\nshiny",
      };
    };

    let saved: UpdateCache | undefined;
    const save = async (cache: UpdateCache) => {
      saved = cache;
    };

    const target = await resolveUpgradeTarget("1.0.0", check, save);

    // The fresh check ran with the current version...
    expect(checkedWith).toBe("1.0.0");
    // ...and its result is returned verbatim (not any cached value).
    expect(target.latestVersion).toBe("9.9.9");
    expect(target.hasUpdate).toBe(true);
    expect(target.changelog).toBe("## v9.9.9\nshiny");
    // ...and the cache is refreshed for the background notice.
    expect(saved?.latestVersion).toBe("9.9.9");
    expect(saved?.hasUpdate).toBe(true);
    expect(typeof saved?.lastCheckAt).toBe("string");
  });

  test("reports no update when the fresh check finds none", async () => {
    const check = async (currentVersion: string): Promise<UpdateInfo> => ({
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      aheadOfLatest: false,
    });
    const save = async () => {};

    const target = await resolveUpgradeTarget("2.3.4", check, save);
    expect(target.hasUpdate).toBe(false);
    expect(target.latestVersion).toBe("2.3.4");
  });
});
