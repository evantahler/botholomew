import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CallToolResult, McpxClient } from "@evantahler/mcpx";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getMcpxDir, MCPX_SERVERS_FILENAME } from "../constants.ts";

/**
 * Resolve the mcpx config directory for a project, honoring `mcpx_scope`:
 *   - "global"  → `~/.mcpx` (shared across all Botholomew projects)
 *   - "project" → `<projectDir>/mcpx` (isolated per project)
 */
export function resolveMcpxDir(
  projectDir: string,
  config: Pick<BotholomewConfig, "mcpx_scope">,
): string {
  return config.mcpx_scope === "project"
    ? getMcpxDir(projectDir)
    : join(homedir(), ".mcpx");
}

/**
 * Create an McpxClient from `<mcpxDir>/servers.json`. Returns null if the
 * file is missing or has no servers configured. The caller is responsible
 * for resolving `mcpxDir` via `resolveMcpxDir`.
 */
export async function createMcpxClient(
  mcpxDir: string,
): Promise<McpxClient | null> {
  const serversPath = join(mcpxDir, MCPX_SERVERS_FILENAME);
  if (!existsSync(serversPath)) return null;

  const raw = await Bun.file(serversPath).text();
  const parsed = JSON.parse(raw);

  if (!parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0) {
    return null;
  }

  const authPath = join(mcpxDir, "auth.json");
  const auth = existsSync(authPath)
    ? JSON.parse(await Bun.file(authPath).text())
    : {};

  const searchPath = join(mcpxDir, "search.json");
  const searchIndex = existsSync(searchPath)
    ? JSON.parse(await Bun.file(searchPath).text())
    : undefined;

  return new McpxClient({
    servers: parsed,
    auth,
    searchIndex,
    configDir: mcpxDir,
  });
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
