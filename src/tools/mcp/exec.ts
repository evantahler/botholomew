import { z } from "zod";
import { formatCallToolResult } from "../../mcpx/client.ts";
import { fakeMcpExec, isCaptureMode } from "../../worker/fake-mcp.ts";
import { getTool, type ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  server: z.string().describe("MCP server name"),
  tool: z.string().describe("Tool name on the server"),
  args: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Tool arguments as a JSON object"),
});

const errorKindSchema = z
  .enum(["retryable", "permanent", "input_error", "auth_error"])
  .optional();

const outputSchema = z.object({
  result: z.string(),
  is_error: z.boolean(),
  error_kind: errorKindSchema,
  hint: z.string().optional(),
});

type ErrorKind = z.infer<typeof errorKindSchema>;

function classifyError(err: unknown): { error_kind: ErrorKind; hint: string } {
  const msg = String(err).toLowerCase();

  if (
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("503")
  ) {
    return {
      error_kind: "retryable",
      hint: "Transient network error. Retry after a pause.",
    };
  }

  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("authentication") ||
    msg.includes("auth")
  ) {
    return {
      error_kind: "auth_error",
      hint: "Authentication failed. Check MCP server credentials. Not retryable.",
    };
  }

  if (
    msg.includes("invalid") ||
    msg.includes("validation") ||
    msg.includes("required") ||
    msg.includes("schema")
  ) {
    return {
      error_kind: "input_error",
      hint: `Tool rejected input. Use mcp_info to check the expected schema for ${msg}, then retry with corrected arguments.`,
    };
  }

  return {
    error_kind: "permanent",
    hint: "Unexpected error. Use mcp_search to find an alternative tool.",
  };
}

export const mcpExecTool = {
  name: "mcp_exec",
  description:
    "Execute a tool on an MCP server. Use mcp_list_tools or mcp_search to discover available tools first, and mcp_info to check the expected input schema.",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    // Guard: the agent sometimes routes a top-level Botholomew tool through
    // mcp_exec (e.g. read_large_result on a payload that originated from an
    // MCP server). Bounce with a clear redirect rather than forwarding to a
    // server that doesn't have the tool.
    if (getTool(input.tool)) {
      return {
        result: `\`${input.tool}\` is a top-level Botholomew tool, not an MCP tool. Call it directly by name instead of routing it through mcp_exec.`,
        is_error: true,
        error_kind: "input_error" as const,
        hint: `Re-emit a tool_use block with name="${input.tool}" and its own input schema. Do not wrap it in mcp_exec.`,
      };
    }
    if (isCaptureMode()) {
      const canned = fakeMcpExec(input.server, input.tool, input.args);
      if (canned) {
        return {
          result: canned,
          is_error: false,
          error_kind: undefined,
          hint: undefined,
        };
      }
    }
    if (!ctx.mcpxClient) {
      return {
        result:
          "No MCP servers configured. This task requires external tool access. Add servers with `botholomew mcpx add`.",
        is_error: true,
        error_kind: "permanent" as const,
        hint: "Consider calling fail_task noting that MCP servers need to be configured.",
      };
    }

    try {
      const callResult = await ctx.mcpxClient.exec(
        input.server,
        input.tool,
        input.args,
      );
      const isError = callResult.isError ?? false;
      return {
        result: formatCallToolResult(callResult),
        is_error: isError,
        error_kind: undefined,
        hint: isError
          ? "The tool returned an error. Check the error message and use mcp_info to verify you're passing the correct arguments."
          : undefined,
      };
    } catch (err) {
      const { error_kind, hint } = classifyError(err);
      return {
        result: `MCP tool error: ${err}`,
        is_error: true,
        error_kind,
        hint,
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
