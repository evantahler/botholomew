import { getHostFunctionContext } from "run";
import {
  callKey,
  consumeApproval,
  findByCallKey,
} from "../../../approvals/store.ts";
import { withMcpApprovalBypass } from "../../../mcpx/bypass.ts";
import { buildApprovalPolicy } from "../../../mcpx/client.ts";
import { fakeMcpSearch, isCaptureMode } from "../../../worker/fake-mcp.ts";
import { dispatchMcpExec, parseMcpPayload } from "../../mcp/dispatch.ts";
import type { ToolContext } from "../../tool.ts";
import { HostOpError } from "./errors.ts";
import { PREVIEW_CHARS } from "./limits.ts";

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HostOpError("host_error", `${name} must be a non-empty string.`);
  }
  return value;
}

function asArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HostOpError("host_error", "args must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

async function toolNeedsApproval(
  ctx: ToolContext,
  server: string,
  tool: string,
): Promise<boolean> {
  if (!ctx.approvalGateActive) return false;
  if (!ctx.mcpxClient) return false;
  const policy = buildApprovalPolicy(ctx.config);
  if (typeof policy !== "function") return false;
  try {
    const schema = await ctx.mcpxClient.info(server, tool);
    if (!schema) return false;
    return policy(schema, server);
  } catch {
    return false;
  }
}

async function execOrCapture(
  ctx: ToolContext,
  server: string,
  tool: string,
  args: Record<string, unknown> | undefined,
): Promise<string> {
  const { interrupt, resume } = getHostFunctionContext();

  if (resume === undefined) {
    if (await toolNeedsApproval(ctx, server, tool)) {
      interrupt({
        kind: "approval",
        server,
        tool,
        args: args ?? {},
        message: `Approve ${server}/${tool}?`,
      });
    }
    const dispatched = await dispatchMcpExec({ server, tool, args }, ctx);
    if (!dispatched.ok) {
      throw new HostOpError(
        "mcp_error",
        `${dispatched.result} ${dispatched.hint}`,
      );
    }
    return dispatched.result;
  }

  if (resume.resolution !== true) {
    throw new HostOpError(
      "mcp_error",
      `This action was denied by a human reviewer (${server}/${tool}). Do not retry the same call.`,
    );
  }

  const dispatched = await withMcpApprovalBypass(() =>
    dispatchMcpExec({ server, tool, args }, ctx),
  );
  const existing = await findByCallKey(
    ctx.projectDir,
    callKey(server, tool, args),
  );
  if (existing) await consumeApproval(ctx.projectDir, existing.id);
  if (!dispatched.ok) {
    throw new HostOpError(
      "mcp_error",
      `${dispatched.result} ${dispatched.hint}`,
    );
  }
  return dispatched.result;
}

export function createMcpHost(ctx: ToolContext) {
  return {
    listTools: async (server?: unknown) => {
      const filter = typeof server === "string" ? server : undefined;
      if (!ctx.mcpxClient) return [];
      const tools = await ctx.mcpxClient.listTools(filter);
      return tools.map((t) => ({
        server: t.server,
        name: t.tool.name,
        description: t.tool.description ?? "",
      }));
    },
    search: async (query: unknown) => {
      const q = requireString(query, "query");
      if (isCaptureMode()) {
        const canned = fakeMcpSearch(q);
        if (canned) return canned;
      }
      if (!ctx.mcpxClient) return [];
      try {
        const results = await ctx.mcpxClient.search(q);
        return results.map((r) => ({
          server: r.server,
          tool: r.tool,
          description: r.description ?? "",
          score: r.score,
        }));
      } catch (err) {
        throw new HostOpError(
          "mcp_error",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    info: async (server: unknown, tool: unknown) => {
      const s = requireString(server, "server");
      const t = requireString(tool, "tool");
      if (!ctx.mcpxClient) {
        return {
          found: false,
          name: t,
          description: "No MCP servers configured.",
          input_schema: "{}",
        };
      }
      const schema = await ctx.mcpxClient.info(s, t);
      if (!schema) {
        return {
          found: false,
          name: t,
          description: `Tool "${t}" not found on server "${s}".`,
          input_schema: "{}",
        };
      }
      return {
        found: true,
        name: schema.name,
        description: schema.description ?? "",
        input_schema: JSON.stringify(schema.inputSchema ?? {}, null, 2),
      };
    },
    exec: async (server: unknown, tool: unknown, args?: unknown) => {
      const s = requireString(server, "server");
      const t = requireString(tool, "tool");
      const a = asArgs(args);
      const text = await execOrCapture(ctx, s, t, a);
      return parseMcpPayload(text);
    },
    capture: async (
      server: unknown,
      tool: unknown,
      args: unknown,
      logicalPath: unknown,
    ) => {
      const s = requireString(server, "server");
      const t = requireString(tool, "tool");
      const path = requireString(logicalPath, "logicalPath");
      const a = asArgs(args);
      const text = await execOrCapture(ctx, s, t, a);
      try {
        const written = await ctx.withMem((mem) =>
          mem.write({ logical_path: path, content: text }),
        );
        return {
          logical_path: written.logical_path,
          version_id: written.version_id,
          size_bytes: written.size_bytes,
          preview: text.slice(0, PREVIEW_CHARS),
        };
      } catch (err) {
        throw new HostOpError(
          "write_failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
