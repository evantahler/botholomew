#!/usr/bin/env bun

import { program } from "commander";
import { registerChatCommand } from "./commands/chat.ts";
import { registerContextCommand } from "./commands/context.ts";
import { registerDaemonCommand } from "./commands/daemon.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerMcpxCommand } from "./commands/mcpx.ts";
import { registerTaskCommand } from "./commands/task.ts";
import { registerToolCommands } from "./commands/tools.ts";

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

program.action(() => {
  program.help();
});

program.parse();
