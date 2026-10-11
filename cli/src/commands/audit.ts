import type { Command } from "commander";
import {
  addPageOptions,
  compact,
  decorateHelp,
  emit,
  pageQuery,
  runAction,
  sessionRequest,
} from "../helpers.ts";
import { resolveProjectId } from "../resolve.ts";

/**
 * Register audit log listing.
 * @param program - The root program.
 */
export function registerAuditCommands(program: Command): void {
  const audit = decorateHelp(
    program.command("audit").description("Project audit log"),
  );

  decorateHelp(
    addPageOptions(
      audit
        .command("list")
        .description("List audit entries")
        .option("--since <ts>", "Start of range (ISO or epoch ms)", "0")
        .option("--until <ts>", "End of range (ISO or epoch ms)")
        .option("--action <name>", "Exact action name, e.g. tag:edit"),
    ).action(async function (this: Command) {
      await runAction(this, async (ctx) => {
        const opts = this.optsWithGlobals() as {
          page?: string;
          limit?: string;
          since: string;
          until?: string;
          action?: string;
        };
        const projectId = await resolveProjectId(ctx);
        emit(
          ctx,
          await sessionRequest(ctx, "GET", "/audit-logs", {
            query: compact({
              projectId,
              since: opts.since,
              until: opts.until,
              action: opts.action,
              ...pageQuery(opts),
            }),
          }),
        );
      });
    }),
  );
}
