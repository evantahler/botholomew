import { green, red, yellow } from "ansis";
import type { Command } from "commander";
import { updater } from "../update/updater.ts";

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade botholomew to the latest version")
    .action(async () => {
      try {
        // `updater.upgrade()` always performs a fresh check first (never
        // trusting a possibly-stale background cache), detects the install
        // method, and installs in place. It never writes to the console or
        // exits — presentation is ours.
        const result = await updater.upgrade();

        if (!result.hasUpdate) {
          console.log(
            green(`botholomew is already up to date (v${result.from})`),
          );
          return;
        }

        if (result.method === "local-dev") {
          console.log(
            yellow(
              "Running from source. Use `git pull && bun install` to update.",
            ),
          );
          return;
        }

        if (result.success) {
          console.log(
            green(
              `Successfully upgraded botholomew: v${result.from} → v${result.to} (${result.method})`,
            ),
          );
        } else {
          if (result.error) console.error(red(result.error));
          console.error(red("Upgrade failed. See errors above."));
          process.exit(1);
        }
      } catch (err) {
        console.error("Upgrade failed");
        console.error(String(err));
        process.exit(1);
      }
    });
}
