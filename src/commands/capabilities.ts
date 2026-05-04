import type { Command } from "commander";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../config/loader.ts";
import { writeCapabilitiesFile } from "../context/capabilities.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { withDb } from "./with-db.ts";

export function registerCapabilitiesCommand(program: Command) {
  program
    .command("capabilities")
    .description(
      "Regenerate persistent-context/capabilities.md by scanning built-in tools and MCPX tools",
    )
    .option("--no-mcp", "Skip MCPX tool enumeration (built-in tools only)")
    .action((opts: { mcp?: boolean }) =>
      withDb(program, async (_conn, dir) => {
        const includeMcp = opts.mcp !== false;
        const spinner = createSpinner("Loading config").start();
        const config = await loadConfig(dir);
        spinner.update({ text: "Connecting to MCPX servers" });
        const mcpxClient = includeMcp ? await createMcpxClient(dir) : null;
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
      }),
    );
}
