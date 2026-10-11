import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "src", "index.ts");
const OUT = join(ROOT, "dist", "botholomew.js");

/**
 * Bundle the CLI into a single Node-runnable file.
 *
 * Source stays TypeScript with a Bun shebang for `bun run --cwd cli botholomew`.
 * The package's bins (`botholomew` and `bothy`) point at this file, with a Node
 * shebang, so an installed copy runs without Bun. The package is `private`, so
 * nothing publishes it.
 */
async function build(): Promise<void> {
  await mkdir(join(ROOT, "dist"), { recursive: true });
  const proc = Bun.spawn(
    [
      process.execPath,
      "build",
      ENTRY,
      "--outfile",
      OUT,
      "--target",
      "node",
      "--packages",
      "bundle",
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`bun build exited ${code}`);
  }
  const body = await readFile(OUT, "utf8");
  const stripped = body.replace(/^#!.*\n/, "");
  await writeFile(OUT, `#!/usr/bin/env node\n${stripped}`);
  await chmod(OUT, 0o755);
}

await build();
