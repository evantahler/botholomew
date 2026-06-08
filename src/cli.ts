#!/usr/bin/env bun

import ansis from "ansis";
import { program } from "commander";
import { registerCapabilitiesCommand } from "./commands/capabilities.ts";
import { registerChatCommand } from "./commands/chat.ts";
import { registerCheckUpdateCommand } from "./commands/check-update.ts";
import { registerDreamCommand } from "./commands/dream.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMcpxCommand } from "./commands/mcpx.ts";
import { registerMembotCommand } from "./commands/membot.ts";
import { registerNukeCommand } from "./commands/nuke.ts";
import { registerPrepareCommand } from "./commands/prepare.ts";
import { registerPromptsCommand } from "./commands/prompts.ts";
import { registerScheduleCommand } from "./commands/schedule.ts";
import { registerSkillCommand } from "./commands/skill.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerTaskCommand } from "./commands/task.ts";
import { registerThreadCommand } from "./commands/thread.ts";
import { registerUpgradeCommand } from "./commands/upgrade.ts";
import { registerWorkerCommand } from "./commands/worker.ts";
import { pkg } from "./pkg.ts";
import { IS_COMPILED_BINARY } from "./runtime.ts";
import { maybeCheckForUpdate } from "./update/background.ts";
import { runWorkerFromArgv } from "./worker/run.ts";
import { WORKER_RUN_SENTINEL } from "./worker/sentinel.ts";

// In a compiled binary there is no source tree to `bun run`, so a backgrounded
// worker re-execs this binary with a sentinel arg (see worker/spawn.ts). Handle
// it before commander sees it. Also force the embedder to stay in-process —
// membot's subprocess pool would re-exec the binary with its own sentinel,
// which our CLI doesn't understand.
if (IS_COMPILED_BINARY) {
  process.env.MEMBOT_EMBEDDING_WORKERS ??= "1";
  // Find the sentinel by value rather than position — Bun's compiled-binary
  // argv layout differs from `bun run`, so we slice everything after it.
  const sentinelIdx = process.argv.indexOf(WORKER_RUN_SENTINEL);
  if (sentinelIdx !== -1) {
    await runWorkerFromArgv(process.argv.slice(sentinelIdx + 1));
    process.exit(0);
  }
}

program
  .name("botholomew")
  .description(ansis.bold(pkg.description))
  .version(pkg.version)
  .option("-d, --dir <path>", "project directory", process.cwd())
  .configureHelp({
    styleTitle: (str) => ansis.bold(str),
    styleUsage: (str) => ansis.cyan(str),
    styleCommandText: (str) => ansis.cyan.bold(str),
    styleSubcommandTerm: (str) => ansis.green(str),
    styleSubcommandDescription: (str) => ansis.dim(str),
    styleOptionTerm: (str) => ansis.yellow(str),
    styleOptionDescription: (str) => ansis.dim(str),
    styleArgumentTerm: (str) => ansis.magenta(str),
    styleArgumentDescription: (str) => ansis.dim(str),
  });

registerInitCommand(program);
registerStatusCommand(program);
registerWorkerCommand(program);
registerTaskCommand(program);
registerThreadCommand(program);
registerScheduleCommand(program);
registerChatCommand(program);
registerDreamCommand(program);
registerMembotCommand(program);
registerCapabilitiesCommand(program);
registerPromptsCommand(program);
registerMcpxCommand(program);
registerSkillCommand(program);
registerNukeCommand(program);
registerPrepareCommand(program);
registerCheckUpdateCommand(program);
registerUpgradeCommand(program);

// Bare `botholomew` (only the global -d/--dir, or nothing) prints help on
// stdout and exits 0. We do this explicitly instead of via a root .action()
// handler, because that handler made Commander treat a mistyped command as an
// excess positional argument ("too many arguments. Expected 0 arguments but
// got 1: foo.") instead of reporting an unknown command. With no root action, a
// real typo now reaches Commander's unknownCommand() → "error: unknown command
// 'foo'" (plus a did-you-mean suggestion).
function isBareInvocation(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "-d" || a === "--dir") {
      i++; // skip the option's value
      continue;
    }
    if (a.startsWith("--dir=")) continue;
    return false; // any operand OR other flag (--help, --version, foo, …)
  }
  return true;
}

if (isBareInvocation(process.argv.slice(2))) {
  program.help(); // outputs to stdout and exits 0
}

// Start background update check before parsing (non-blocking)
const updateNotice = maybeCheckForUpdate();

program.parse();

// Print update notice to stderr after command completes
updateNotice.then((notice) => {
  if (notice) process.stderr.write(notice);
});
