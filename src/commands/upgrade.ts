import { tmpdir } from "node:os";
import { join } from "node:path";
import { dim, green, red, yellow } from "ansis";
import { $ } from "bun";
import type { Command } from "commander";
import {
  clearUpdateCache,
  loadUpdateCache,
  saveUpdateCache,
} from "../update/cache.ts";
import type { UpdateCache } from "../update/checker.ts";
import {
  checkForUpdate,
  detectInstallMethod,
  type InstallMethod,
  needsCheck,
} from "../update/checker.ts";

const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

const GITHUB_REPO = (pkg.repository.url as string)
  .replace(/^https:\/\/github\.com\//, "")
  .replace(/\.git$/, "");

function platformArtifactName(): string {
  let os: string;
  let ext = "";
  switch (process.platform) {
    case "darwin":
      os = "darwin";
      break;
    case "win32":
      os = "windows";
      ext = ".exe";
      break;
    default:
      os = "linux";
      break;
  }
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `botholomew-${os}-${arch}${ext}`;
}

async function upgradeWithPackageManager(
  command: string,
  args: string[],
): Promise<boolean> {
  const result = await $`${command} ${args}`.nothrow();
  return result.exitCode === 0;
}

async function upgradeFromBinary(latestVersion: string): Promise<boolean> {
  const artifact = platformArtifactName();
  const tag = `v${latestVersion}`;
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${artifact}`;

  const tmpPath = join(tmpdir(), `botholomew-upgrade-${Date.now()}`);
  const targetPath = process.execPath;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(red(`Failed to download binary: HTTP ${res.status}`));
      return false;
    }

    const bytes = await res.arrayBuffer();
    await Bun.write(tmpPath, bytes);

    await $`chmod +x ${tmpPath}`.quiet();

    // Try to move into place
    const mv = await $`mv ${tmpPath} ${targetPath}`.quiet().nothrow();

    if (mv.exitCode !== 0) {
      // Try with sudo
      console.log(dim("Requires elevated permissions..."));
      const sudo = await $`sudo mv ${tmpPath} ${targetPath}`.nothrow();
      if (sudo.exitCode !== 0) {
        console.error(red("Failed to install binary. Try running with sudo."));
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error(red(`Failed to upgrade binary: ${err}`));
    // Clean up temp file
    await $`rm -f ${tmpPath}`.quiet().nothrow();
    return false;
  }
}

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade botholomew to the latest version")
    .action(async () => {
      try {
        // Check for update (use cache if fresh)
        const cache = await loadUpdateCache();
        let latestVersion: string;
        let hasUpdate: boolean;

        if (!needsCheck(cache) && cache) {
          latestVersion = cache.latestVersion;
          hasUpdate = cache.hasUpdate;
        } else {
          const info = await checkForUpdate(pkg.version);
          latestVersion = info.latestVersion;
          hasUpdate = info.hasUpdate;

          const newCache: UpdateCache = {
            lastCheckAt: new Date().toISOString(),
            latestVersion,
            hasUpdate,
            changelog: info.changelog,
          };
          await saveUpdateCache(newCache);
        }

        if (!hasUpdate) {
          console.log(
            green(`botholomew is already up to date (v${pkg.version})`),
          );
          return;
        }

        const method: InstallMethod = detectInstallMethod();
        console.log(
          `Upgrading from v${pkg.version} to v${latestVersion} (${method})...`,
        );

        let success = false;

        switch (method) {
          case "bun":
            success = await upgradeWithPackageManager("bun", [
              "install",
              "-g",
              `${pkg.name}@${latestVersion}`,
            ]);
            break;

          case "npm":
            success = await upgradeWithPackageManager("npm", [
              "install",
              "-g",
              `${pkg.name}@${latestVersion}`,
            ]);
            break;

          case "binary":
            success = await upgradeFromBinary(latestVersion);
            break;

          case "local-dev":
            console.log(
              yellow(
                "Running from source. Use `git pull && bun install` to update.",
              ),
            );
            return;
        }

        if (success) {
          await clearUpdateCache();
          console.log(
            green(
              `Successfully upgraded botholomew: v${pkg.version} → v${latestVersion}`,
            ),
          );
        } else {
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
