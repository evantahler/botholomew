import type { McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig, NotifyChannel } from "../config/schemas.ts";
import {
  createMcpxClient,
  formatCallToolResult,
  resolveMcpxDir,
} from "../mcpx/client.ts";
import { logger } from "../utils/logger.ts";
import type { Notification } from "./dispatch.ts";
import { renderArgs } from "./template.ts";

type McpxNotifyChannel = Extract<NotifyChannel, { type: "mcpx" }>;

/**
 * Cache of un-gated mcpx clients keyed by resolved config dir. Notify targets
 * come from trusted `config.json`, so they are pre-approved: we build the client
 * WITHOUT an approval policy (see `createMcpxClient` — omitting `approval` gates
 * nothing), sidestepping the human-in-the-loop gate that the agent's shared
 * `ctx.mcpxClient` enforces. Cached so repeated dispatches reuse one client.
 */
const clientCache = new Map<string, McpxClient | null>();

async function getNotifyClient(dir: string): Promise<McpxClient | null> {
  if (clientCache.has(dir)) return clientCache.get(dir) ?? null;
  const client = await createMcpxClient(dir);
  clientCache.set(dir, client);
  return client;
}

/**
 * Deliver a notification through a configured mcpx tool. Substitutes
 * `{{title}}`/`{{message}}`/`{{severity}}` into the channel args, then execs the
 * tool. Throws on any failure so the dispatcher records the channel as failed.
 */
export async function sendMcpx(
  channel: McpxNotifyChannel,
  n: Notification,
  config: BotholomewConfig,
  projectDir: string,
): Promise<void> {
  const dir = resolveMcpxDir(projectDir, config);
  const client = await getNotifyClient(dir);
  if (!client) {
    throw new Error(
      `No mcpx servers configured at ${dir}; cannot deliver via ${channel.server}/${channel.tool}.`,
    );
  }
  const args = renderArgs(channel.args, n);
  const result = await client.exec(channel.server, channel.tool, args);
  if (result.isError) {
    throw new Error(
      `${channel.server}/${channel.tool} returned an error: ${formatCallToolResult(result)}`,
    );
  }
  logger.debug(
    `Notified via ${channel.server}/${channel.tool}: ${formatCallToolResult(result)}`,
  );
}
