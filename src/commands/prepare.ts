import type { Command } from "commander";
import { warmupEmbedder } from "../context/embedder.ts";
import { logger } from "../utils/logger.ts";

export function registerPrepareCommand(program: Command) {
  program
    .command("prepare")
    .description(
      "Download and cache required models. Run this in CI or on first setup.",
    )
    .action(async () => {
      logger.info("Preparing Botholomew...");
      await warmupEmbedder();
      logger.success("All models downloaded and ready.");
    });
}
