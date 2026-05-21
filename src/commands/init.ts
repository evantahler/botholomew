import type { Command } from "commander";
import type { LlmProvider } from "../config/schemas.ts";
import { initProject } from "../init/index.ts";
import { logger } from "../utils/logger.ts";

function parseScope(value: string): "global" | "project" {
  if (value !== "global" && value !== "project") {
    throw new Error(`scope must be "global" or "project" (got "${value}")`);
  }
  return value;
}

function parseProvider(value: string): LlmProvider {
  if (
    value !== "anthropic" &&
    value !== "ollama" &&
    value !== "openai-compatible"
  ) {
    throw new Error(
      `provider must be one of: anthropic, ollama, openai-compatible (got "${value}")`,
    );
  }
  return value;
}

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a new Botholomew project in the current directory")
    .option(
      "--force",
      "overwrite existing project files; also bypass the unsupported-filesystem check (iCloud/Dropbox/etc)",
    )
    .option(
      "--membot-scope <scope>",
      'where this project reads/writes its knowledge store: "global" (default; shared ~/.membot) or "project" (per-project index.duckdb)',
      parseScope,
    )
    .option(
      "--mcpx-scope <scope>",
      'where this project reads its MCPX config: "global" (default; shared ~/.mcpx) or "project" (per-project mcpx/)',
      parseScope,
    )
    .option(
      "--provider <provider>",
      'LLM provider to preconfigure: "anthropic" (default), "ollama" (local), or "openai-compatible" (LM Studio, OpenRouter, etc.)',
      parseProvider,
    )
    .action(async (opts) => {
      const dir = program.opts().dir;
      try {
        await initProject(dir, {
          force: opts.force,
          membotScope: opts.membotScope,
          mcpxScope: opts.mcpxScope,
          provider: opts.provider,
        });
      } catch (err) {
        logger.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    });
}
