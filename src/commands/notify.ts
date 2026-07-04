import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import type { Severity } from "../notify/dispatch.ts";
import { dispatchNotification } from "../notify/dispatch.ts";
import { logger } from "../utils/logger.ts";

const SEVERITIES: Severity[] = ["info", "warning", "error"];

export function registerNotifyCommand(program: Command) {
  program
    .command("notify <message>")
    .description(
      "Send a notification through the configured channels (verify your setup)",
    )
    .option("-t, --title <title>", "notification title", "Botholomew")
    .option(
      "-s, --severity <severity>",
      `severity (${SEVERITIES.join("|")})`,
      "info",
    )
    .option(
      "-c, --channel <type>",
      "only deliver to channels of this type (desktop|mcpx)",
    )
    .action(async (message, opts) => {
      const dir = program.opts().dir;
      const config = await loadConfig(dir);

      if (!SEVERITIES.includes(opts.severity)) {
        logger.error(
          `Invalid severity "${opts.severity}". Use one of: ${SEVERITIES.join(", ")}.`,
        );
        process.exit(1);
      }

      const channels = opts.channel
        ? config.notify.channels.filter((c) => c.type === opts.channel)
        : undefined;
      if (opts.channel && channels && channels.length === 0) {
        logger.error(
          `No "${opts.channel}" channels configured in config.json.`,
        );
        process.exit(1);
      }

      const result = await dispatchNotification(
        {
          title: opts.title,
          message,
          severity: opts.severity as Severity,
          source: "cli",
        },
        config,
        { projectDir: dir, channels },
      );

      if (result.delivered.length > 0) {
        logger.success(`Delivered via ${result.delivered.join(", ")}`);
      }
      for (const f of result.failed) {
        logger.error(`${f.channel}: ${f.error}`);
      }
      if (result.delivered.length === 0) {
        if (result.failed.length === 0) {
          logger.warn(
            "No channels delivered. Check the `notify` block in config.json.",
          );
        }
        process.exit(1);
      }
    });
}
