import {
  ToolApprovalDeniedError,
  ToolApprovalRequiredError,
} from "@evantahler/mcpx";
import { ApprovalPendingError } from "../../approvals/errors.ts";
import { formatCallToolResult } from "../../mcpx/client.ts";
import { fakeMcpExec, isCaptureMode } from "../../worker/fake-mcp.ts";
import { getTool, type ToolContext } from "../tool.ts";

export const MCP_ERROR_KINDS = [
  "retryable",
  "permanent",
  "input_error",
  "auth_error",
] as const;

export type McpErrorKind = (typeof MCP_ERROR_KINDS)[number];

export interface McpDispatchOk {
  ok: true;
  result: string;
}

export interface McpDispatchErr {
  ok: false;
  result: string;
  error_kind: McpErrorKind;
  hint: string;
  approvalId?: string;
}

export type McpDispatchResult = McpDispatchOk | McpDispatchErr;

export function classifyMcpError(err: unknown): {
  error_kind: McpErrorKind;
  hint: string;
} {
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

/**
 * Shared MCP execution path used by `mcp_exec` and the `membot_run` sandbox.
 * Does not decide the approval gate — callers that already have a human
 * resolution should wrap this in `withMcpApprovalBypass`.
 */
export async function dispatchMcpExec(
  input: {
    server: string;
    tool: string;
    args?: Record<string, unknown>;
  },
  ctx: ToolContext,
): Promise<McpDispatchResult> {
  if (getTool(input.tool)) {
    return {
      ok: false,
      result: `\`${input.tool}\` is a top-level Botholomew tool, not an MCP tool. Call it directly by name instead of routing it through mcp_exec.`,
      error_kind: "input_error",
      hint: `Re-emit a tool_use block with name="${input.tool}" and its own input schema. Do not wrap it in mcp_exec.`,
    };
  }
  if (isCaptureMode()) {
    const canned = fakeMcpExec(input.server, input.tool, input.args);
    if (canned) {
      return { ok: true, result: canned };
    }
  }
  if (!ctx.mcpxClient) {
    return {
      ok: false,
      result:
        "No MCP servers configured. This task requires external tool access. Add servers with `botholomew mcpx add`.",
      error_kind: "permanent",
      hint: "Consider calling fail_task noting that MCP servers need to be configured.",
    };
  }

  try {
    const callResult = await ctx.mcpxClient.exec(
      input.server,
      input.tool,
      input.args,
    );
    const formatted = formatCallToolResult(callResult);
    if (callResult.isError) {
      return {
        ok: false,
        result: formatted,
        error_kind: "permanent",
        hint: "The tool returned an error. Check the error message and use mcp_info to verify you're passing the correct arguments.",
      };
    }
    return { ok: true, result: formatted };
  } catch (err) {
    if (err instanceof ApprovalPendingError) {
      ctx.onApprovalPending?.(err.approvalId);
      return {
        ok: false,
        result: `This action is queued for human approval (id ${err.approvalId}).`,
        error_kind: "permanent",
        hint: `Awaiting approval. Call wait_task with a reason referencing approval ${err.approvalId}; the task will be re-queued automatically once a human approves or denies it.`,
        approvalId: err.approvalId,
      };
    }
    if (err instanceof ToolApprovalDeniedError) {
      return {
        ok: false,
        result: `This action was denied by a human reviewer (${input.server}/${input.tool}).`,
        error_kind: "permanent",
        hint: "Do not retry the same call — the human said no. Try a different approach, or call fail_task explaining that the required action was denied.",
      };
    }
    if (err instanceof ToolApprovalRequiredError) {
      return {
        ok: false,
        result: `This action requires approval, but no approver is wired up.`,
        error_kind: "permanent",
        hint: "The approval gate is active but no approver is available. Call fail_task; a human must re-run with --unsafe or allowlist this tool in config.",
      };
    }
    const { error_kind, hint } = classifyMcpError(err);
    return {
      ok: false,
      result: `MCP tool error: ${err}`,
      error_kind,
      hint,
    };
  }
}

export function parseMcpPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
