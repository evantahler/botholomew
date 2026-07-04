import type {
  BotholomewConfig,
  NotifyChannel,
  NotifyEvents,
} from "../config/schemas.ts";
import { logger } from "../utils/logger.ts";
import { sendDesktop } from "./desktop.ts";
import { sendMcpx } from "./mcpx.ts";

export type Severity = "info" | "warning" | "error";

export interface Notification {
  title: string;
  message: string;
  /** Defaults to "info" when omitted. */
  severity?: Severity;
  /** Free-form origin tag for logs, e.g. "worker", "chat", "task:<id>". */
  source?: string;
}

export interface DispatchResult {
  /** Channel labels that delivered successfully (e.g. "desktop", "mcpx:slack/send"). */
  delivered: string[];
  /** Channel labels that threw, with their error message. */
  failed: { channel: string; error: string }[];
}

export function channelLabel(channel: NotifyChannel): string {
  return channel.type === "mcpx"
    ? `mcpx:${channel.server}/${channel.tool}`
    : "desktop";
}

async function sendToChannel(
  channel: NotifyChannel,
  n: Notification,
  config: BotholomewConfig,
  projectDir: string,
): Promise<void> {
  if (channel.type === "desktop") return sendDesktop(n);
  return sendMcpx(channel, n, config, projectDir);
}

/**
 * Pure fan-out core: attempt each channel with the supplied `send` function,
 * collecting successes and swallowing failures into `failed`. Never throws — a
 * broken channel can't take down its siblings or the caller. `send` is injected
 * so this is testable without spawning processes or opening mcpx clients.
 */
export async function dispatchToChannels(
  channels: NotifyChannel[],
  send: (channel: NotifyChannel) => Promise<void>,
): Promise<DispatchResult> {
  const result: DispatchResult = { delivered: [], failed: [] };
  await Promise.all(
    channels.map(async (channel) => {
      const label = channelLabel(channel);
      try {
        await send(channel);
        result.delivered.push(label);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ channel: label, error: message });
        logger.warn(`Notification via ${label} failed: ${message}`);
      }
    }),
  );
  return result;
}

/**
 * Fan a notification out to the configured channels. Each channel is attempted
 * independently: one failing channel is caught and logged, never rethrown, so a
 * broken Slack config can't fail the task that triggered the notify. Every
 * dispatch is logged (this is the "still logged" guarantee for the mcpx
 * gate-bypass). A no-op when notifications are disabled.
 */
export async function dispatchNotification(
  n: Notification,
  config: BotholomewConfig,
  opts: { projectDir: string; channels?: NotifyChannel[] },
): Promise<DispatchResult> {
  if (!config.notify.enabled) {
    logger.debug(`Notifications disabled; dropping "${n.title}".`);
    return { delivered: [], failed: [] };
  }
  const channels = opts.channels ?? config.notify.channels;
  const origin = n.source ? ` (${n.source})` : "";
  logger.debug(
    `Dispatching notification "${n.title}"${origin} to ${channels.length} channel(s).`,
  );

  return dispatchToChannels(channels, (channel) =>
    sendToChannel(channel, n, config, opts.projectDir),
  );
}

/**
 * Fire an event-driven notification if the corresponding toggle is on. Guarded
 * so a notify failure never changes worker control flow — safe to `void`.
 * Returns the dispatch result, or `null` when the event was skipped (disabled
 * master switch or the per-event toggle is off).
 */
export async function maybeNotifyEvent(
  projectDir: string,
  config: BotholomewConfig,
  event: keyof NotifyEvents,
  n: Notification,
): Promise<DispatchResult | null> {
  if (!config.notify.enabled || !config.notify.events[event]) return null;
  try {
    return await dispatchNotification(n, config, { projectDir });
  } catch (err) {
    logger.warn(`notify hook (${event}) errored: ${err}`);
    return { delivered: [], failed: [] };
  }
}
