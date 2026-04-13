import type { Command } from "commander";
import { logger } from "../utils/logger.ts";

export function registerContextCommand(program: Command) {
  const ctx = program.command("context").description("Manage context items");

  ctx
    .command("list")
    .description("List context items")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });

  ctx
    .command("add <path>")
    .description("Add a file or directory to context")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });

  ctx
    .command("search <query>")
    .description("Search context items")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });
}
