import { cyan, dim, green, yellow } from "ansis";
import type { Command } from "commander";
import { saveUpdateCache } from "../update/cache.ts";
import type { UpdateCache } from "../update/checker.ts";
import { checkForUpdate } from "../update/checker.ts";

const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

export function registerCheckUpdateCommand(program: Command) {
  program
    .command("check-update")
    .description("Check for a newer version of botholomew")
    .action(async () => {
      try {
        const info = await checkForUpdate(pkg.version);

        // Save to cache
        const cache: UpdateCache = {
          lastCheckAt: new Date().toISOString(),
          latestVersion: info.latestVersion,
          hasUpdate: info.hasUpdate,
          changelog: info.changelog,
        };
        await saveUpdateCache(cache);

        if (!info.hasUpdate) {
          if (info.aheadOfLatest) {
            console.log(
              yellow(
                `botholomew v${info.currentVersion} is ahead of latest published release (v${info.latestVersion})`,
              ),
            );
          } else {
            console.log(
              green(`botholomew is up to date (v${info.currentVersion})`),
            );
          }
          return;
        }

        console.log(
          yellow(
            `Update available: ${info.currentVersion} → ${info.latestVersion}`,
          ),
        );

        if (info.changelog) {
          console.log("");
          console.log(dim(info.changelog));
        }

        console.log("");
        console.log(cyan("Run `botholomew upgrade` to update"));
      } catch (err) {
        console.error("Failed to check for updates");
        console.error(String(err));
        process.exit(1);
      }
    });
}
