#!/usr/bin/env bun
/**
 * Drives VHS (https://github.com/charmbracelet/vhs) to regenerate every GIF
 * under docs/assets/ from the tapes in docs/tapes/. All LLM calls are faked
 * via BOTHOLOMEW_FAKE_LLM so the run is hermetic — no API key required.
 *
 * Usage:
 *   bun run scripts/capture.ts              # run all tapes
 *   bun run scripts/capture.ts <tape-name>  # run a single tape (name or path)
 */

import { $ } from "bun";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tapesDir = join(repoRoot, "docs", "tapes");
const fixturesDir = join(tapesDir, "fixtures");
const cliPath = join(repoRoot, "src", "cli.ts");

function die(msg: string): never {
  process.stderr.write(`\u001b[31merror:\u001b[0m ${msg}\n`);
  process.exit(1);
}

function info(msg: string): void {
  process.stdout.write(`\u001b[36m→\u001b[0m ${msg}\n`);
}

async function requireBinary(bin: string, installHint: string): Promise<void> {
  const result = await $`which ${bin}`.nothrow().quiet();
  if (result.exitCode !== 0) die(`'${bin}' not found on PATH. ${installHint}`);
}

function listTapes(filter?: string): string[] {
  const glob = new Bun.Glob("*.tape");
  const tapes: string[] = [];
  for (const name of glob.scanSync({ cwd: tapesDir })) {
    if (name.startsWith("_")) continue;
    if (filter) {
      const f = basename(filter, ".tape");
      if (basename(name, ".tape") !== f) continue;
    }
    tapes.push(join(tapesDir, name));
  }
  return tapes.sort();
}

function fixtureFor(tapePath: string): string {
  const name = basename(tapePath, ".tape");
  const path = join(fixturesDir, `${name}.json`);
  if (!existsSync(path)) {
    die(`missing fixture for tape '${name}': expected ${path}`);
  }
  return path;
}

function createBinWrapper(workDir: string): string {
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, "botholomew");
  // Pin --dir so the TUI uses the ephemeral project regardless of VHS cwd.
  writeFileSync(
    wrapper,
    `#!/bin/sh
exec bun run ${cliPath} --dir ${workDir} "$@"
`,
  );
  chmodSync(wrapper, 0o755);
  return binDir;
}

async function runOne(tape: string, binDir: string): Promise<void> {
  const fixture = fixtureFor(tape);
  info(`capturing ${basename(tape)}  ←  ${basename(fixture)}`);

  // VHS reads the tape from a path, renders in ttyd, and writes the Output
  // file resolved relative to its own cwd. Run from the repo root so the
  // `Output docs/assets/<name>.gif` lines drop into the committed location.
  const result = await $`vhs ${tape}`
    .cwd(repoRoot)
    .env({
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      BOTHOLOMEW_FAKE_LLM: "1",
      BOTHOLOMEW_FAKE_LLM_FIXTURE: fixture,
      BOTHOLOMEW_NO_UPDATE_CHECK: "1",
      // A syntactically-valid stub — the fake client never hits the network.
      ANTHROPIC_API_KEY: "sk-ant-fake",
    })
    .nothrow();
  if (result.exitCode !== 0) die(`vhs failed for ${tape} (exit ${result.exitCode})`);
}

async function main(): Promise<void> {
  await requireBinary(
    "vhs",
    "Install with 'brew install vhs ttyd ffmpeg' on macOS or see https://github.com/charmbracelet/vhs#installation",
  );
  await requireBinary("ttyd", "VHS needs ttyd. Install with 'brew install ttyd'.");
  await requireBinary(
    "ffmpeg",
    "VHS needs ffmpeg. Install with 'brew install ffmpeg'.",
  );

  const filter = process.argv[2];
  const tapes = listTapes(filter);
  if (tapes.length === 0) die(filter ? `no tape matches '${filter}'` : "no tapes found");

  // Ephemeral working dir — the chat TUI reads --dir from cwd, so we init a
  // throwaway project here and run VHS from it to keep local state untouched.
  const workDir = mkdtempSync(join(tmpdir(), "botholomew-capture-"));
  info(`work dir: ${workDir}`);
  const binDir = createBinWrapper(workDir);

  try {
    const init = await $`bun run ${cliPath} --dir ${workDir} init`
      .cwd(workDir)
      .env({ ...process.env, BOTHOLOMEW_NO_UPDATE_CHECK: "1" })
      .nothrow();
    if (init.exitCode !== 0) die(`botholomew init failed (exit ${init.exitCode})`);

    for (const tape of tapes) {
      await runOne(tape, binDir);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  info(`done — assets in ${join(repoRoot, "docs", "assets")}`);
}

await main();
