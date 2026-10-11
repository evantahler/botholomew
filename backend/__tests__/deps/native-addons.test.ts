import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

/**
 * Nothing in this install compiles a native addon.
 *
 * An addon calling a libuv function Bun has not implemented on POSIX takes the
 * process down with `panic: unsupported uv function` (oven-sh/bun#18546) —
 * uncatchably, so a package wrapping its optional bindings in `try`/`catch`
 * does not save `bun test`. Whether it fires depends on which `node` compiled
 * the addon, since Bun refuses a foreign ABI with an ordinary `Error`, so it
 * hides on one machine and crashes on the next. Blocking the install script is
 * the only guard, and these assertions are about the install rather than any
 * package name: the next binding to arrive inherits the crash. The local
 * embedder and code mode are WASM for the same reason.
 */

/** The repository root, two levels above `backend/__tests__`. */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Every directory an install may place packages in. Which one holds real files
 * is Bun's linker's choice — the isolated store, or each workspace — so all of
 * them are scanned.
 */
const INSTALL_ROOTS = ["", "backend", "frontend", "cli"].map((workspace) =>
  join(REPO_ROOT, workspace, "node_modules"),
);

/**
 * Where `node-gyp` leaves what it compiled. Narrower than any `.node` on
 * purpose: a prebuilt N-API module ships one at its package root, and those
 * Bun loads.
 */
const GYP_OUTPUT = "**/build/{Release,Debug}/*.node";

/** A package that describes a native addon to `node-gyp`. */
const BINDING_GYP = "**/binding.gyp";

/**
 * Scan every install root for one glob.
 * @param pattern - The glob, relative to each root.
 * @returns Absolute paths, across all roots that exist.
 */
function scanInstall(pattern: string): string[] {
  const glob = new Bun.Glob(pattern);
  const found: string[] = [];
  for (const root of INSTALL_ROOTS) {
    if (!existsSync(root)) continue;
    // `dot` because the isolated store is `node_modules/.bun`, and symlinks
    // stay unfollowed so a workspace's link farm is not walked twice.
    for (const hit of glob.scanSync({
      cwd: root,
      onlyFiles: true,
      dot: true,
    })) {
      found.push(join(root, hit));
    }
  }
  return found;
}

/**
 * The name of the package owning a file, from the nearest `package.json` above
 * it.
 * @param file - An absolute path inside an installed package.
 * @returns The package name, or the path itself if no manifest is found.
 */
function owningPackage(file: string): string {
  let dir = dirname(file);
  while (
    dir.includes(`${sep}node_modules${sep}`) ||
    dir.endsWith(`${sep}node_modules`)
  ) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
      };
      if (name) return name;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return file;
}

/** The root manifest, which is the only one Bun reads a trust list from. */
const rootManifest = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as { trustedDependencies?: string[] };

describe("native addons", () => {
  test("the root manifest declares a trust list of its own, naming only esbuild", () => {
    // Presence is the mechanism: with no `trustedDependencies` key at all, Bun
    // falls back to its default list, which trusts packages that compile
    // addons. The exact contents are the review point: a name added here is an
    // install script that runs on every machine and in every image.
    expect(rootManifest.trustedDependencies).toEqual(["esbuild"]);
  });

  test("no package that compiles an addon is trusted to run its install script", () => {
    const trusted = new Set(rootManifest.trustedDependencies ?? []);
    const gypPackages = new Set(scanInstall(BINDING_GYP).map(owningPackage));

    // Vacuity guard: an empty scan is also what a scan of the wrong directory
    // looks like, so prove the roots hold the install before trusting "none".
    expect(scanInstall("**/keryx/package.json").length).toBeGreaterThan(0);

    expect([...gypPackages].filter((name) => trusted.has(name))).toEqual([]);
  });

  test("the install produced no compiled addon at all", () => {
    // The whole set rather than a lookup for names known to crash.
    expect(scanInstall(GYP_OUTPUT)).toEqual([]);
  });
});
