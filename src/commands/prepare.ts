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
        if (!config.openai_api_key) {
          logger.error(
            "OpenAI API key not set. Set openai_api_key in config or OPENAI_API_KEY env var.",
          );
          process.exit(1);
        }
        await embedSingle("test", config);
        logger.success("OpenAI embeddings API is reachable and configured.");
      }),
    );
}
