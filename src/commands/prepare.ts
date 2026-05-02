import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import { embedSingle } from "../context/embedder.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

export function registerPrepareCommand(program: Command) {
  program
    .command("prepare")
    .description("Verify API keys and connectivity. Run this on first setup.")
    .action(() =>
      withDb(program, async (_conn, dir) => {
        logger.info("Preparing Botholomew...");
        const config = await loadConfig(dir);
        await embedSingle("test", config);
        logger.success(
          `Embedding model ${config.embedding_model} is loaded and ready.`,
        );
      }),
    );
}
