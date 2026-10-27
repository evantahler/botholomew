import type { Command } from "commander";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { createMcpxClient, resolveMcpxDir } from "../mcpx/client.ts";
import { writeCapabilitiesFile } from "../prompts/capabilities.ts";
import { registerAllTools } from "../tools/registry.ts";

export function registerCapabilitiesCommand(program: Command) {
  program
    .command("capabilities")
    .description(
      "Regenerate prompts/capabilities.md by scanning built-in tools and MCPX tools",
    )
    .option("--no-mcp", "Skip MCPX tool enumeration (built-in tools only)")
    .action(async (opts: { mcp?: boolean }) => {
      const dir = program.opts().dir as string;
      const includeMcp = opts.mcp !== false;
      registerAllTools();
      const spinner = createSpinner("Loading config").start();
      const config = await loadConfig(dir);
      spinner.update({ text: "Connecting to MCPX servers" });
      const mcpxClient = includeMcp
        ? await createMcpxClient(resolveMcpxDir(dir, config))
        : null;
      try {
        const result = await writeCapabilitiesFile(
          dir,
          mcpxClient,
          config,
          (phase) => spinner.update({ text: phase }),
        );
        const bits = [
          `${result.counts.internal} built-in`,
          `${result.counts.mcp} MCPX`,
        ];
        if (!includeMcp) bits.push("MCPX skipped");
        spinner.success({
          text: `Wrote ${result.path} (${bits.join(", ")})`,
        });
      } catch (err) {
        spinner.error({ text: `Failed: ${(err as Error).message}` });
        await mcpxClient?.close();
        process.exit(1);
      }
      await mcpxClient?.close();
      process.exit(0);
    });
}
