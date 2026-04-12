import type { Command } from "commander";
import { logger } from "../utils/logger.ts";

export function registerMcpxCommand(program: Command) {
  const mcpx = program
    .command("mcpx")
    .description("Manage MCP servers via MCPX");

  mcpx
    .command("list")
    .description("List configured MCP servers")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });

  mcpx
    .command("add <server>")
    .description("Add an MCP server")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });

  mcpx
    .command("test <tool>")
    .description("Test a tool call")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });
}
