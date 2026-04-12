import type { Command } from "commander";
import { initProject } from "../init/index.ts";
import { logger } from "../utils/logger.ts";

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a new Botholomew project in the current directory")
    .option("--force", "overwrite existing .botholomew directory")
    .action(async (opts) => {
      const dir = program.opts().dir;
      try {
        await initProject(dir, { force: opts.force });
      } catch (err) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    });
}
