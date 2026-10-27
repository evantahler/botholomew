import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import { openMembot, resolveMembotDir } from "../mem/client.ts";
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
      const mem = openMembot(resolveMembotDir(projectDir, config));
      try {
        await mem.connect();
        logger.success("membot knowledge store opened successfully");
      } finally {
        await mem.close();
      }
    });
}
