#! /usr/bin/env bun

import pkg from "./package.json";
import { Action, api } from "./api";
import { Command } from "commander";
import { globLoader } from "./util/glob";
import { addActionToProgram } from "./util/cli";

const program = new Command();
program.name(pkg.name).description(pkg.description).version(pkg.version);

program
  .command("start")
  .summary("Run the server")
  .description("Start the botholomew server")
  .action(async () => {
    await api.start();
  });

const actions = await globLoader<Action>("actions");
actions.forEach((action) => addActionToProgram(program, action));

program
  .command("actions")
  .summary("List all actions")
  .action(async () => {
    const actionSpacing =
      actions.map((a) => a.name.length).reduce((a, b) => Math.max(a, b), 0) + 2;
    const routeSpacing =
      actions
        .map((a) =>
          a.web ? a.web.route.toString().length + a.web.method.length : 0,
        )
        .reduce((a, b) => Math.max(a, b), 0) + 2;

    actions
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((action) => {
        console.log(
          `${action.name}${" ".repeat(actionSpacing - action.name.length)} ${action.web ? `[${action.web.method}] ${action.web.route}` : " "}${" ".repeat(routeSpacing - (action.web ? action.web.method.length + action.web.route.toString().length + 2 : 0))} ${action.description ?? ""}`,
        );
      });
  });

program
  .command("migrate")
  .summary("Run migrations")
  .action(async () => {
    await api.initialize();
    await api.db.generateMigrations();
    await api.stop();
    process.exit(0);
  });

program.parse();
