import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import { openMembot } from "../mem/client.ts";
import { logger } from "../utils/logger.ts";

export function registerPrepareCommand(program: Command) {
  program
    .command("prepare")
    .description(
      "Verify the project is healthy: load config and open the membot knowledge store (triggers any first-run migration / model download).",
    )
    .action(async () => {
      const projectDir = program.opts().dir as string;
      logger.info("Preparing Botholomew...");
      const config = await loadConfig(projectDir);
      void config;
      const mem = openMembot(projectDir);
      try {
        await mem.connect();
        logger.success("membot knowledge store opened successfully");
      } finally {
        await mem.close();
      }
    });
}
