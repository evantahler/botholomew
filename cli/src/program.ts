import { Command } from "commander";
import { registerAuditCommands } from "./commands/audit.ts";
import { registerAuthCommands } from "./commands/auth.ts";
import {
  registerInviteCommands,
  registerMemberCommands,
  registerTagCommands,
} from "./commands/ops.ts";
import { registerProjectCommands } from "./commands/project.ts";
import { DEFAULT_BASE_URL } from "./config.ts";
import { decorateHelp } from "./helpers.ts";

/**
 * Build the `botholomew` Commander program.
 *
 * Default API origin is {@link DEFAULT_BASE_URL} (`https://api.botholomew.com`).
 * Local development is `--url http://localhost:8080`.
 * @returns The program.
 */
export function createProgram(): Command {
  const program = new Command();
  decorateHelp(
    program
      .name("botholomew")
      .description(
        "Botholomew CLI. Talks HTTP to a Botholomew API; does not boot the server.",
      )
      .option(
        "--url <origin>",
        `API origin without /api (default ${DEFAULT_BASE_URL})`,
      )
      .option("--project <id-or-slug>", "Project id or slug")
      .option("--json", "Machine-readable JSON (no banner, no color)")
      .option("--no-color", "Disable color"),
  );

  registerAuthCommands(program);
  registerProjectCommands(program);
  registerTagCommands(program);
  registerMemberCommands(program);
  registerInviteCommands(program);
  registerAuditCommands(program);

  return program;
}
