#!/usr/bin/env bun
// Virtual specifiers supplied + embedded (via the "file" loader) by
// scripts/build.ts at compile time; each resolves to its $bunfs path string.
// @ts-expect-error: virtual module resolved + embedded by scripts/build.ts at compile time
import dylibPath from "bothy:duckdb-dylib";
// @ts-expect-error: virtual module resolved + embedded by scripts/build.ts at compile time
import ortMjsPath from "bothy:ort-wasm-mjs";
// @ts-expect-error: virtual module resolved + embedded by scripts/build.ts at compile time
import ortWasmPath from "bothy:ort-wasm-wasm";
// Build-only entrypoint for the compiled binary (`bun run build`; see
// scripts/build.ts). Not used under `bun run` in dev.
//
// A `bun build --compile` binary has no node_modules on disk, and Bun resolves
// neither externalized native packages nor `import.meta.resolve(...)` against
// the real filesystem. So we EMBED the native assets that can't be bundled —
// DuckDB's shared library and onnxruntime-web's WASM runtime — and stage them
// in a temp dir BEFORE the code that loads them runs:
//   • DuckDB: the embedded `duckdb.node` is extracted by Bun into os.tmpdir()
//     and dlopens its library via an `@loader_path` rpath, so the library must
//     sit in that same dir.
//   • Embeddings: membot's embedder reads BOTHOLOMEW_ORT_WASM_{MJS,WASM} (the
//     build rewrites its `import.meta.resolve(...)` calls to use these) instead
//     of resolving onnxruntime-web from a (missing) node_modules.
// The dynamic `import("./cli.ts")` guarantees all of this is in place before the
// real CLI — and its transitive duckdb/transformers imports — are evaluated.
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MCPX_CLI_SENTINEL, MEMBOT_CLI_SENTINEL } from "./runtime.ts";

const stageDir = realpathSync(tmpdir());

/** Copy an embedded asset into the temp dir (skip if an identical one exists). */
function stage(embedded: string, name: string): string {
  const dest = join(stageDir, name);
  if (!existsSync(dest) || statSync(dest).size !== statSync(embedded).size) {
    writeFileSync(dest, readFileSync(embedded));
  }
  return dest;
}

// DuckDB shared library — must land where Bun extracts the addon (os.tmpdir())
// under exactly the name the addon's rpath expects. scripts/build.ts globs that
// name from the binding package and injects it here via --define.
declare const BOTHOLOMEW_DUCKDB_LIB: string;
stage(dylibPath, BOTHOLOMEW_DUCKDB_LIB);

// onnxruntime-web WASM runtime — staged side by side; membot's embedder reads
// these env vars (the build rewrites its import.meta.resolve calls).
const mjs = stage(ortMjsPath, "ort-wasm-simd-threaded.asyncify.mjs");
const wasm = stage(ortWasmPath, "ort-wasm-simd-threaded.asyncify.wasm");
process.env.BOTHOLOMEW_ORT_WASM_MJS = pathToFileURL(mjs).href;
process.env.BOTHOLOMEW_ORT_WASM_WASM = pathToFileURL(wasm).href;

// The membot/mcpx passthroughs re-exec this binary with a sentinel arg; hand
// off to the bundled upstream CLI in this dedicated process (commands/membot.ts,
// commands/mcpx.ts). Otherwise run the normal Botholomew CLI.
const argv = process.argv;
const membotIdx = argv.indexOf(MEMBOT_CLI_SENTINEL);
const mcpxIdx = argv.indexOf(MCPX_CLI_SENTINEL);
if (membotIdx !== -1) {
  process.argv = [process.execPath, "membot", ...argv.slice(membotIdx + 1)];
  await import("membot/cli");
} else if (mcpxIdx !== -1) {
  process.argv = [process.execPath, "mcpx", ...argv.slice(mcpxIdx + 1)];
  await import("@evantahler/mcpx/cli");
} else {
  await import("./cli.ts");
}
