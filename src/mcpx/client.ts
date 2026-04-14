import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CallToolResult, McpxClient } from "@evantahler/mcpx";
import { getMcpxDir, MCPX_SERVERS_FILENAME } from "../constants.ts";

/**
 * Create an McpxClient from the project's .botholomew/mcpx/servers.json.
 * Returns null if the file is missing or has no servers configured.
 */
export async function createMcpxClient(
  projectDir: string,
): Promise<McpxClient | null> {
  const serversPath = join(getMcpxDir(projectDir), MCPX_SERVERS_FILENAME);
  if (!existsSync(serversPath)) return null;

  const raw = await Bun.file(serversPath).text();
  const parsed = JSON.parse(raw);

  if (!parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0) {
    return null;
  }

  return new McpxClient({ servers: parsed });
}

/**
 * Serialize a CallToolResult's content array into a plain text string.
 */
export function formatCallToolResult(result: CallToolResult): string {
  if (!result.content || !Array.isArray(result.content)) {
    return JSON.stringify(result);
  }

  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === "text") {
      parts.push(block.text ?? "");
    } else if (block.type === "image") {
      parts.push(`[image: ${block.mimeType}]`);
    } else if (block.type === "resource") {
      const uri =
        typeof block.resource === "object"
          ? (block.resource as Record<string, unknown>).uri
          : block.resource;
      parts.push(`[resource: ${uri}]`);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n");
}
