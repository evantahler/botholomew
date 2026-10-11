import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  engines?: { node?: string };
  publishConfig?: { access?: string; provenance?: boolean };
};

const pkg = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as PackageJson;

describe("package manifest", () => {
  test("is named botholomew, with both bins on one bundle", () => {
    expect(pkg.name).toBe("botholomew");
    expect(pkg.bin).toEqual({
      botholomew: "dist/botholomew.js",
      bothy: "dist/botholomew.js",
    });
  });

  test("is private, so nothing can publish 2.0 over v1 users' npm latest", () => {
    // v1 is the `botholomew` package on npm, and its self-updater reads the
    // registry. `private: true` makes `npm publish` refuse outright; lifting it
    // is a deliberate decision about what a v1 user's upgrade does.
    expect(pkg.private).toBe(true);
    expect(pkg.publishConfig).toBeUndefined();
    expect(pkg.scripts?.prepublishOnly).toBeUndefined();
  });

  test("packs the Node bundle, not TypeScript source", () => {
    expect(pkg.files).toContain("dist/botholomew.js");
    expect(pkg.files?.some((f) => f.includes("src"))).toBe(false);
    expect(pkg.files?.some((f) => f.includes("__tests__"))).toBe(false);
  });

  test("version is the 2.0 alpha and engines require Node 18+", () => {
    expect(pkg.version).toBe("2.0.0-alpha.0");
    expect(pkg.engines?.node).toBe(">=18");
  });

  test("the build produces the bin and the dev script runs source", () => {
    expect(pkg.scripts?.build).toBe("bun scripts/build.ts");
    expect(pkg.scripts?.botholomew).toBe("bun src/index.ts");
  });
});

describe("Node bundle", () => {
  test("builds a node-shebang binary that prints help", async () => {
    const build = Bun.spawn([process.execPath, "run", "build"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    const out = readFileSync(join(ROOT, "dist", "botholomew.js"), "utf8");
    expect(out.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(out).not.toContain("#!/usr/bin/env bun");

    const proc = Bun.spawn(
      ["node", join(ROOT, "dist", "botholomew.js"), "--help"],
      {
        cwd: ROOT,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout).toContain("BOTHOLOMEW");
    expect(stdout).toContain("Usage: botholomew");
  }, 60_000);
});
