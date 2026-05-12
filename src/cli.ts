#!/usr/bin/env bun

import ansis from "ansis";
import { program } from "commander";
import { registerCapabilitiesCommand } from "./commands/capabilities.ts";
import { registerChatCommand } from "./commands/chat.ts";
import { registerCheckUpdateCommand } from "./commands/check-update.ts";
import { registerContextCommand } from "./commands/context.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMcpxCommand } from "./commands/mcpx.ts";
import { registerNukeCommand } from "./commands/nuke.ts";
import { registerPrepareCommand } from "./commands/prepare.ts";
import { registerPromptsCommand } from "./commands/prompts.ts";
import { registerScheduleCommand } from "./commands/schedule.ts";
import { registerSkillCommand } from "./commands/skill.ts";
import { registerTaskCommand } from "./commands/task.ts";
import { registerThreadCommand } from "./commands/thread.ts";
import { registerUpgradeCommand } from "./commands/upgrade.ts";
import { registerWorkerCommand } from "./commands/worker.ts";
import { maybeCheckForUpdate } from "./update/background.ts";

const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();

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
registerWorkerCommand(program);
registerTaskCommand(program);
registerThreadCommand(program);
registerScheduleCommand(program);
registerChatCommand(program);
registerContextCommand(program);
registerCapabilitiesCommand(program);
registerPromptsCommand(program);
registerMcpxCommand(program);
registerSkillCommand(program);
registerNukeCommand(program);
registerPrepareCommand(program);
registerCheckUpdateCommand(program);
registerUpgradeCommand(program);

program.action(() => {
  program.help();
});

// Start background update check before parsing (non-blocking)
const updateNotice = maybeCheckForUpdate();

program.parse();

// Print update notice to stderr after command completes
updateNotice.then((notice) => {
  if (notice) process.stderr.write(notice);
});
