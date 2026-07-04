import { z } from "zod";
import { dispatchNotification } from "../../notify/dispatch.ts";
import { logger } from "../../utils/logger.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  title: z.string().describe("Short notification headline"),
  message: z.string().describe("Notification body — the detail the user reads"),
  severity: z
    .enum(["info", "warning", "error"])
    .default("info")
    .describe("Severity (default: info)"),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  delivered_channels: z
    .array(z.string())
    .describe("Channels that delivered successfully"),
  message: z.string(),
  next_action_hint: z.string().optional(),
});

export const notifyTool = {
  name: "notify",
  description:
    "Send a notification to the user through their configured channels (desktop popup, Slack/email via mcpx, …). Use to announce task completion or ask for attention when the user isn't watching the thread.",
  group: "notify",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const result = await dispatchNotification(
      {
        title: input.title,
        message: input.message,
        severity: input.severity,
        source: ctx.workerId ? "worker" : "chat",
      },
      ctx.config,
      { projectDir: ctx.projectDir },
    );

    const msg = `Notified user: ${input.title}`;
    if (ctx.notify) ctx.notify(msg);
    else logger.info(msg);

    if (result.delivered.length === 0) {
      const detail =
        result.failed.length > 0
          ? result.failed.map((f) => `${f.channel} (${f.error})`).join("; ")
          : "no channels configured";
      return {
        is_error: true,
        delivered_channels: [],
        message: `Notification not delivered: ${detail}`,
        next_action_hint:
          "Check the `notify` block in config.json — ensure `enabled` is true and at least one channel is configured.",
      };
    }

    return {
      is_error: false,
      delivered_channels: result.delivered,
      message: `Delivered via ${result.delivered.join(", ")}`,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
