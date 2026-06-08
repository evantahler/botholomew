import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ApprovalPolicy,
  type CallToolResult,
  isWriteable,
  McpxClient,
  type Tool,
  type ToolApprovalCallback,
} from "@evantahler/mcpx";
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

export interface McpxApprovalOptions {
  /** mcpx approval policy. Omit/undefined ⇒ no gate (back-compat). */
  approvalPolicy?: ApprovalPolicy;
  /** Callback invoked when a gated tool is about to run. */
  onApprovalRequired?: ToolApprovalCallback;
}

/**
 * Create an McpxClient from `<mcpxDir>/servers.json`. Returns null if the
 * file is missing or has no servers configured. The caller is responsible
 * for resolving `mcpxDir` via `resolveMcpxDir`.
 *
 * Pass `approval` to wire the human-in-the-loop approval gate (see
 * `buildApprovalPolicy`). When omitted the client gates nothing.
 */
export async function createMcpxClient(
  mcpxDir: string,
  approval: McpxApprovalOptions = {},
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
    approvalPolicy: approval.approvalPolicy,
    onApprovalRequired: approval.onApprovalRequired,
  });
}

/**
 * Translate the Botholomew `approvals` config into an mcpx `ApprovalPolicy`.
 *
 * The gate is ON by default and gates **every** mcpx tool; the predicate
 * returns `true` (require approval) for any tool NOT covered by the allowlist
 * (and, when `auto_allow_read_only`, not annotated read-only). Returns
 * `undefined` — meaning "gate nothing", mcpx's zero-overhead path — when the
 * run is `--unsafe` or `approvals.enabled` is false.
 */
export function buildApprovalPolicy(
  config: Pick<BotholomewConfig, "approvals">,
  opts: { unsafe?: boolean } = {},
): ApprovalPolicy | undefined {
  const approvals = config.approvals;
  if (opts.unsafe || !approvals.enabled) return undefined;
  return (tool: Tool, server: string): boolean => {
    if (approvals.auto_allow_read_only && !isWriteable(tool)) return false;
    return !matchesAllowlist(approvals.allowed_tools, server, tool.name);
  };
}

/**
 * True when "server/toolName" matches any allowlist pattern. Patterns:
 *   - exact "server/tool"
 *   - wildcard, where "*" on either side of the slash matches anything
 *   - a "/regex/" (with optional flags) tested against the tool name
 * A bare token with no slash matches the tool name (server side wildcarded).
 */
export function matchesAllowlist(
  patterns: string[],
  server: string,
  toolName: string,
): boolean {
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const close = pattern.lastIndexOf("/");
      const body = pattern.slice(1, close);
      const flags = pattern.slice(close + 1);
      try {
        if (new RegExp(body, flags).test(toolName)) return true;
      } catch {
        // invalid regex — ignore this pattern
      }
      continue;
    }
    const [serverPat, toolPat] = pattern.includes("/")
      ? pattern.split("/", 2)
      : ["*", pattern];
    if (wildcardEq(serverPat, server) && wildcardEq(toolPat, toolName)) {
      return true;
    }
  }
  return false;
}

function wildcardEq(pattern: string | undefined, value: string): boolean {
  if (pattern === undefined || pattern === "*" || pattern === "") return true;
  return pattern === value;
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
