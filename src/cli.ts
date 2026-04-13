#!/usr/bin/env bun

import { program } from "commander";
import { registerChatCommand } from "./commands/chat.ts";
import { registerCheckUpdateCommand } from "./commands/check-update.ts";
import { registerContextCommand } from "./commands/context.ts";
import { registerDaemonCommand } from "./commands/daemon.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMcpxCommand } from "./commands/mcpx.ts";
import { registerTaskCommand } from "./commands/task.ts";
import { registerToolCommands } from "./commands/tools.ts";
import { registerUpgradeCommand } from "./commands/upgrade.ts";
import { maybeCheckForUpdate } from "./update/background.ts";

const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();

program
  .name("botholomew")
  .description("An AI agent for knowledge work")
  .version(pkg.version)
  .option("-d, --dir <path>", "project directory", process.cwd());

registerInitCommand(program);
registerDaemonCommand(program);
registerTaskCommand(program);
registerChatCommand(program);
registerContextCommand(program);
registerMcpxCommand(program);
registerToolCommands(program);
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
