import type { Command } from "commander";
import { logger } from "../utils/logger.ts";

export function registerChatCommand(program: Command) {
  program
    .command("chat")
    .description("Open the interactive chat TUI")
    .action(async () => {
      logger.warn("Chat TUI not yet implemented. Coming soon.");
    });
}
