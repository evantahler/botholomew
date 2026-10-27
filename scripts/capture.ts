#!/usr/bin/env bun
/**
 * Drives VHS (https://github.com/charmbracelet/vhs) to regenerate every GIF
 * under docs/assets/ from the tapes in docs/tapes/. All LLM calls are faked
 * via BOTHOLOMEW_FAKE_LLM so the run is hermetic — no API key required.
 *
 * Each tape gets its own freshly-initialised ephemeral project directory
 * seeded with a task, a schedule, and a context item so TUI panels and CLI
 * subcommands have realistic data to show.
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
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openMembot } from "../src/mem/client.ts";
import {
  createThread,
  endThread,
  logInteraction,
  updateThreadTitle,
} from "../src/threads/store.ts";
import { uuidv7 } from "../src/utils/uuid.ts";
import { registerWorker } from "../src/workers/store.ts";

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

function fixtureFor(tapePath: string): string | null {
  const name = basename(tapePath, ".tape");
  const path = join(fixturesDir, `${name}.json`);
  return existsSync(path) ? path : null;
}

function readFixtureEnv(fixturePath: string | null): Record<string, string> {
  if (!fixturePath) return {};
  try {
    const body = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      env?: Record<string, string>;
    };
    return body.env ?? {};
  } catch {
    return {};
  }
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

async function addTask(
  workDir: string,
  env: Record<string, string>,
  name: string,
  description: string,
  priority: "low" | "medium" | "high" = "medium",
  status?: string,
): Promise<void> {
  const added = await $`bun run ${cliPath} --dir ${workDir} task add ${name} --description ${description} -p ${priority}`
    .cwd(workDir)
    .env(env)
    .quiet()
    .nothrow();
  if (!status) return;
  const match = added.stdout.toString().match(/\(([0-9a-f-]{36})\)/);
  if (!match) return;
  await $`bun run ${cliPath} --dir ${workDir} task update ${match[1]} --status ${status}`
    .cwd(workDir)
    .env(env)
    .quiet()
    .nothrow();
}

async function addContextFile(
  workDir: string,
  _env: Record<string, string>,
  relativePath: string,
  body: string,
): Promise<void> {
  // Captures init with --membot-scope=project, so the membot store lives at
  // <workDir>/index.duckdb. Write through the SDK so the Context tab and
  // `botholomew membot tree` see the seeded entries.
  const mem = openMembot(workDir);
  try {
    await mem.connect();
    await mem.write({ logical_path: relativePath, content: body });
  } finally {
    await mem.close();
  }
}

async function addHistoricalThread(workDir: string): Promise<void> {
  // One closed thread so the Threads tab shows a row instead of an empty
  // state during the full-tour capture cycle.
  const id = await createThread(workDir, "chat_session");
  await updateThreadTitle(workDir, id, "Yesterday's planning chat");
  await logInteraction(workDir, id, {
    role: "user",
    kind: "message",
    content: "what did I commit to yesterday?",
  });
  await logInteraction(workDir, id, {
    role: "assistant",
    kind: "message",
    content:
      "Three things: ship the v0.8 launch plan, prep Pascal's design review, and reply to Sterling's 1:1 doc.",
  });
  await logInteraction(workDir, id, {
    role: "user",
    kind: "message",
    content: "thanks, set a schedule to remind me each morning.",
  });
  await logInteraction(workDir, id, {
    role: "assistant",
    kind: "message",
    content: "Done — added the morning briefing schedule.",
  });
  await endThread(workDir, id);
}

async function addStubWorker(workDir: string): Promise<void> {
  // A registered worker so the Workers tab is non-empty. The pid is fake;
  // the reaper would mark it dead on a real run, but for capture purposes
  // the cycle dwells for ~24s — well inside the default heartbeat window.
  await registerWorker(workDir, {
    id: uuidv7(),
    pid: 99999,
    hostname: hostname(),
    mode: "persist",
  });
}

function seedMcpxServers(workDir: string): void {
  // The fetcher (`src/context/fetcher.ts`) bails to httpFallback when
  // createMcpxClient returns null. Capture-mode mcp_search/mcp_exec
  // short-circuit on canned data, so the client is never actually called —
  // we just need a non-null client. Stub one server so the file parses.
  const mcpxDir = join(workDir, "mcpx");
  mkdirSync(mcpxDir, { recursive: true });
  writeFileSync(
    join(mcpxDir, "servers.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          "google-docs": {
            command: "echo",
            args: ["capture-mode-stub"],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function seedProject(workDir: string): Promise<void> {
  const env = { ...process.env, BOTHOLOMEW_NO_UPDATE_CHECK: "1" };

  // Pin both stores to the temp workDir so captures stay hermetic (no read
  // or write against the user's real ~/.membot / ~/.mcpx).
  const init = await $`bun run ${cliPath} --dir ${workDir} init --membot-scope project --mcpx-scope project`
    .cwd(workDir)
    .env(env)
    .nothrow();
  if (init.exitCode !== 0) die(`botholomew init failed (exit ${init.exitCode})`);

  // Tasks across priorities and statuses — gives the Tasks panel a realistic
  // mix (pending / in_progress / complete / waiting) so filters & colors are
  // visible in a single frame.
  await addTask(
    workDir,
    env,
    "Draft v0.8 release notes",
    "Compile a changelog from merged PRs since v0.7.",
    "high",
  );
  await addTask(
    workDir,
    env,
    "Summarize tomorrow's calendar",
    "Pull events from Google Calendar and write a briefing.",
    "medium",
    "in_progress",
  );
  await addTask(
    workDir,
    env,
    "Prep design-review notes for Pascal",
    "Surface open questions from last week's thread.",
    "medium",
  );
  await addTask(
    workDir,
    env,
    "Triage Linear inbox",
    "Label and snooze non-urgent issues.",
    "low",
    "complete",
  );
  await addTask(
    workDir,
    env,
    "Reply to Sterling's 1:1 prep doc",
    "Waiting on Sterling to send the agenda.",
    "medium",
    "waiting",
  );

  // Schedules across cadences so the Schedules panel looks lived-in.
  await $`bun run ${cliPath} --dir ${workDir} schedule add ${"Morning briefing"} -f ${"every weekday at 8am"} --description ${"Start-of-day summary of tasks, calendar, and inbox."}`
    .cwd(workDir)
    .env(env)
    .quiet()
    .nothrow();
  await $`bun run ${cliPath} --dir ${workDir} schedule add ${"Weekly review"} -f ${"every Friday at 4pm"} --description ${"Roll up wins, blockers, and next-week plan."}`
    .cwd(workDir)
    .env(env)
    .quiet()
    .nothrow();
  await $`bun run ${cliPath} --dir ${workDir} schedule add ${"Hourly inbox sweep"} -f ${"every hour from 9am to 6pm on weekdays"} --description ${"Label and prioritize incoming mail."}`
    .cwd(workDir)
    .env(env)
    .quiet()
    .nothrow();

  // Context tree — three virtual folders so the Context panel shows depth.
  await addContextFile(
    workDir,
    env,
    "notes/team-schedule.md",
    "# Team schedule\n\n- Tomorrow 10:00 AM — Team standup\n- Tomorrow 11:30 AM — Design review with Pascal\n- Friday 4:30 PM — 1:1 with Sterling\n",
  );
  await addContextFile(
    workDir,
    env,
    "notes/meeting-norms.md",
    "# Meeting norms\n\n- Default to 25 minutes.\n- Agenda in doc, not in invite.\n- Decisions recorded in /decisions/.\n",
  );
  await addContextFile(
    workDir,
    env,
    "projects/v0.8-roadmap.md",
    "# v0.8 roadmap\n\n## Themes\n1. Better MCPX ergonomics\n2. Chat TUI polish\n3. Doc captures\n\n## Target: end of April\n",
  );
  await addContextFile(
    workDir,
    env,
    "projects/pascal-design-review.md",
    "# Design review with Pascal\n\n## Open questions\n- How do we version skill templates?\n- Do we gate context refresh behind rate limits?\n",
  );
  await addContextFile(
    workDir,
    env,
    "people/sterling.md",
    "# Sterling\n\n- Weekly 1:1 Fridays at 4:30 PM\n- Focus areas: reliability, oncall rotation\n- Prefers written agenda 24h ahead\n",
  );

  // Stub mcpx so chat/worker tapes that exercise mcp_search/mcp_exec see a
  // non-null mcpx client — canned fakeMcpSearch/fakeMcpExec take over from
  // there during capture mode.
  seedMcpxServers(workDir);

  // Empty-state tabs in the TUI: seed one historical thread and one
  // registered worker so the full-tour cycle has data on every panel.
  await addHistoricalThread(workDir);
  await addStubWorker(workDir);
}

async function runOne(tape: string): Promise<void> {
  const fixture = fixtureFor(tape);
  info(
    `capturing ${basename(tape)}${fixture ? `  ←  ${basename(fixture)}` : ""}`,
  );

  const workDir = mkdtempSync(join(tmpdir(), "botholomew-capture-"));
  try {
    await seedProject(workDir);
    const binDir = createBinWrapper(workDir);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      BOTHOLOMEW_FAKE_LLM: "1",
      BOTHOLOMEW_NO_UPDATE_CHECK: "1",
      // A syntactically-valid stub — the fake client never hits the network.
      ANTHROPIC_API_KEY: "sk-ant-fake",
    };
    if (fixture) env.BOTHOLOMEW_FAKE_LLM_FIXTURE = fixture;
    Object.assign(env, readFixtureEnv(fixture));

    // VHS writes the Output path resolved relative to its own cwd. Run from
    // the repo root so `Output docs/assets/<name>.gif` lines drop into the
    // committed location.
    const result = await $`vhs ${tape}`.cwd(repoRoot).env(env).nothrow();
    if (result.exitCode !== 0) {
      die(`vhs failed for ${tape} (exit ${result.exitCode})`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
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

  for (const tape of tapes) {
    await runOne(tape);
  }

  info(`done — assets in ${join(repoRoot, "docs", "assets")}`);
}

await main();
