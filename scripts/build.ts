#!/usr/bin/env bun
/**
 * Compile the Botholomew CLI into a single standalone binary.
 *
 * The hard part is DuckDB. `@duckdb/node-bindings` does a 6-branch per-OS
 * `require()` switch over native `.node` addons, and the host addon in turn
 * dlopens a ~112 MB DuckDB shared library via an `@loader_path` rpath. We:
 *   1. Externalize the 5 NON-host binding packages so the bundler doesn't choke
 *      resolving them; the host one is bundled and its `.node` embedded.
 *   2. Embed the host DuckDB shared library and, at startup (cli-standalone.ts),
 *      stage it in the temp dir where Bun extracts the addon so the dlopen
 *      succeeds. The 5 non-host branches never execute at runtime.
 * The onnxruntime-web WASM embedder is bundled too, which needs
 * `@huggingface/transformers` patched first to drop its `onnxruntime-node`
 * import (the native backend can't be bundled). Result: one self-contained
 * file, no sidecar.
 *
 * Usage:
 *   bun run build                                   # host platform
 *   bun run scripts/build.ts --target=bun-linux-x64 # cross-compile (CI matrix)
 */

import { cyan, green, red } from "ansis";
import { $ } from "bun";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg: string): never {
  process.stderr.write(`${red("error:")} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${cyan("→")} ${msg}\n`);
}
function ok(msg: string): void {
  process.stdout.write(`${green("✓")} ${msg}\n`);
}

// Per-platform DuckDB binding package. The shared-library filename inside it
// (libduckdb.dylib / libduckdb.so / duckdb.dll) is discovered by globbing, so
// we stage it under exactly the name the addon's rpath expects.
const DUCKDB_PKG: Record<string, string> = {
  "darwin-arm64": "@duckdb/node-bindings-darwin-arm64",
  "darwin-x64": "@duckdb/node-bindings-darwin-x64",
  "linux-x64": "@duckdb/node-bindings-linux-x64",
  "linux-arm64": "@duckdb/node-bindings-linux-arm64",
  "win32-x64": "@duckdb/node-bindings-win32-x64",
  "win32-arm64": "@duckdb/node-bindings-win32-arm64",
};

// `--target=bun-<os>-<arch>` cross-compiles; omit to build for the host.
const targetFlag = process.argv.find((a) => a.startsWith("--target="));
const target = targetFlag?.slice("--target=".length);
// Map a Bun target (or the host) to our os-arch key.
const osArch = target
  ? target.replace(/^bun-/, "").replace(/-(baseline|modern|musl).*$/, "")
  : `${process.platform}-${process.arch}`;
const duckPkg = DUCKDB_PKG[osArch];
if (!duckPkg) die(`unsupported platform '${osArch}'`);

// ── 1. Patch @huggingface/transformers for the WASM (onnxruntime-web) backend ──
// membot ships the patch; it strips the static `onnxruntime-node` import so the
// bundler doesn't try (and fail) to embed native bindings. Idempotent via a
// marker file; fails loudly if the installed version drifts from the patch's.
const tfDirRel = "node_modules/@huggingface/transformers";
const tfDir = join(repoRoot, tfDirRel);
const patch = join(
  repoRoot,
  "node_modules/membot/patches/@huggingface%2Ftransformers@4.2.0.patch",
);
const marker = join(tfDir, ".botholomew-transformers-patch-applied");
const EXPECTED_TF = "4.2.";

if (!existsSync(tfDir)) die(`${tfDir} not found — run \`bun install\` first.`);
if (!existsSync(patch)) {
  die(`transformers patch not found at ${patch} — is membot installed?`);
}

if (existsSync(marker)) {
  info("transformers patch already applied — skipping");
} else {
  const tfPkg = (await Bun.file(join(tfDir, "package.json")).json()) as {
    version: string;
  };
  if (!tfPkg.version.startsWith(EXPECTED_TF)) {
    die(
      `@huggingface/transformers ${tfPkg.version} is installed but the WASM ` +
        `patch targets ${EXPECTED_TF}x.\n` +
        `  The patch (node_modules/membot/patches/) must match the installed ` +
        `version. Bump membot (which carries the patch) or pin transformers, ` +
        `then retry.`,
    );
  }
  info(`patching @huggingface/transformers ${tfPkg.version} for WASM`);
  const applied = await $`git apply --directory=${tfDirRel} ${patch}`
    .cwd(repoRoot)
    .nothrow();
  if (applied.exitCode !== 0) {
    die(`git apply failed:\n${applied.stderr.toString()}`);
  }
  writeFileSync(marker, "applied by scripts/build.ts\n");
  ok("transformers patched");
}

// ── 2. Compile to a single binary ──
// Discover the DuckDB shared library by globbing the binding package — its
// basename is the leaf the addon dlopens via its rpath, so we stage it under
// the same name at runtime (BOTHOLOMEW_DUCKDB_LIB) regardless of platform.
const bindingDir = join(repoRoot, "node_modules", duckPkg);
if (!existsSync(bindingDir)) {
  die(`${duckPkg} not found — install it (it ships with the target's bindings).`);
}
const duckLib = readdirSync(bindingDir).find(
  (f) => /\.(dylib|dll)$/.test(f) || /\.so(\.\d+)*$/.test(f),
);
if (!duckLib) die(`no DuckDB shared library (.dylib/.so/.dll) in ${bindingDir}`);
const dylibAbs = join(bindingDir, duckLib);

const ortDistRel = "node_modules/onnxruntime-web/dist";
const ortMjsAbs = join(repoRoot, ortDistRel, "ort-wasm-simd-threaded.asyncify.mjs");
const ortWasmAbs = join(repoRoot, ortDistRel, "ort-wasm-simd-threaded.asyncify.wasm");
for (const f of [ortMjsAbs, ortWasmAbs]) {
  if (!existsSync(f)) die(`onnxruntime-web asset not found: ${f}`);
}

const outfile = join(repoRoot, "dist", osArch.startsWith("win32") ? "bothy.exe" : "bothy");
info(`compiling ${target ? `for ${target}` : "for host"} (${osArch}) → ${outfile}`);

// Embed the native assets cli-standalone.ts stages at startup, and rewrite
// membot's embedder so it reads the staged onnxruntime-web paths from env
// instead of calling import.meta.resolve (which can't resolve in a binary).
const embedNativeAssets: Bun.BunPlugin = {
  name: "embed-native-assets",
  setup(build) {
    const virtuals: Record<string, string> = {
      "bothy:duckdb-dylib": dylibAbs,
      "bothy:ort-wasm-mjs": ortMjsAbs,
      "bothy:ort-wasm-wasm": ortWasmAbs,
    };
    // Embed each asset via the "file" loader so the import yields its $bunfs
    // path at runtime. (A plain onResolve→path drops the file-loader semantics.)
    build.onResolve({ filter: /^bothy:/ }, (args) => ({
      path: args.path,
      namespace: "bothy-embed",
    }));
    build.onLoad({ filter: /.*/, namespace: "bothy-embed" }, async (args) => ({
      contents: await Bun.file(virtuals[args.path] as string).bytes(),
      loader: "file",
    }));
    build.onLoad(
      { filter: /[\\/]membot[\\/]src[\\/]ingest[\\/]embedder\.ts$/ },
      async (args) => {
        const src = (await Bun.file(args.path).text())
          .replace(
            'import.meta.resolve("onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs")',
            "(process.env.BOTHOLOMEW_ORT_WASM_MJS as string)",
          )
          .replace(
            'import.meta.resolve("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm")',
            "(process.env.BOTHOLOMEW_ORT_WASM_WASM as string)",
          );
        return { contents: src, loader: "ts" };
      },
    );
  },
};

// mcpx's onnx-wasm-paths.ts statically imports onnxruntime-web WASM via a
// relative path that only resolves in mcpx's own (non-hoisted) repo layout.
// semantic.ts imports it dynamically inside a try/catch and falls back to
// transformers.js' default WASM loader when it throws — so marking it external
// lets the compile succeed; the dynamic import then throws at runtime and the
// fallback takes over. (Our own embeddings go through membot, not mcpx.)
const stubMcpxOnnxWasm: Bun.BunPlugin = {
  name: "stub-mcpx-onnx-wasm",
  setup(build) {
    build.onResolve({ filter: /onnx-wasm-paths(\.ts)?$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

// Ink eagerly imports `react-devtools-core` (an optional dev-only devtools
// hook) at module load. It isn't installed and is never used in production, but
// being eager it can't be `external` (that would crash at startup). Replace it
// with an inert stub bundled into the binary.
const stubReactDevtools: Bun.BunPlugin = {
  name: "stub-react-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub-rdt",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-rdt" }, () => ({
      contents: "export default {}; export const connectToDevTools = () => {};",
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: [join(repoRoot, "src/cli-standalone.ts")],
  // Externalize the non-target DuckDB bindings only — their `require()` branches
  // never execute on this platform, so they don't need to resolve at runtime.
  external: Object.values(DUCKDB_PKG).filter((p) => p !== duckPkg),
  // Tell cli-standalone.ts the exact filename to stage the DuckDB library as.
  define: { BOTHOLOMEW_DUCKDB_LIB: JSON.stringify(duckLib) },
  minify: true,
  sourcemap: "linked",
  plugins: [embedNativeAssets, stubMcpxOnnxWasm, stubReactDevtools],
  compile: target ? { outfile, target: target as Bun.Build.Target } : { outfile },
});

if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`);
  die("bun build --compile failed");
}
ok(`compiled ${outfile} (single file — no sidecar)`);
