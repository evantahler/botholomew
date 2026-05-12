import { describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { mcpExecTool } from "../../../src/tools/mcp/exec.ts";
import { registerAllTools } from "../../../src/tools/registry.ts";
import { setupToolContext } from "../../helpers.ts";

registerAllTools();

function mockClient(
  response: { content: Array<{ type: string; text?: string }> },
  isError = false,
): McpxClient {
  return {
    exec: mock(async () => ({
      ...response,
      isError,
    })),
  } as unknown as McpxClient;
}

describe("mcp_exec", () => {
  test("returns error message when mcpxClient is null", async () => {
    const { ctx } = await setupToolContext();
    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.result).toContain("No MCP servers configured");
    expect(result.error_kind).toBe("permanent");
    expect(result.hint).toBeDefined();
  });

  test("executes tool and returns formatted result", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = mockClient({
      content: [{ type: "text", text: "Email sent successfully" }],
    });

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email", args: { to: "test@test.com" } },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.result).toBe("Email sent successfully");
    expect(result.error_kind).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  test("propagates isError from tool result with hint", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = mockClient(
      {
        content: [{ type: "text", text: "Auth failed" }],
      },
      true,
    );

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.result).toBe("Auth failed");
    expect(result.hint).toContain("mcp_info");
  });

  test("classifies network errors as retryable", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = {
      exec: mock(async () => {
        throw new Error("ECONNREFUSED: connection refused");
      }),
    } as unknown as McpxClient;

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_kind).toBe("retryable");
    expect(result.hint).toContain("Retry");
  });

  test("classifies auth errors", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = {
      exec: mock(async () => {
        throw new Error("401 Unauthorized");
      }),
    } as unknown as McpxClient;

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_kind).toBe("auth_error");
    expect(result.hint).toContain("Not retryable");
  });

  test("classifies input validation errors", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = {
      exec: mock(async () => {
        throw new Error("Validation failed: required field missing");
      }),
    } as unknown as McpxClient;

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_kind).toBe("input_error");
    expect(result.hint).toContain("mcp_info");
  });

  test("classifies unknown errors as permanent", async () => {
    const { ctx } = await setupToolContext();
    ctx.mcpxClient = {
      exec: mock(async () => {
        throw new Error("Something completely unexpected");
      }),
    } as unknown as McpxClient;

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_kind).toBe("permanent");
    expect(result.hint).toContain("alternative tool");
  });

  test("rejects calls that target a top-level Botholomew tool", async () => {
    const { ctx } = await setupToolContext();
    // mcpxClient stays null — the guard should fire before we touch it.
    const result = await mcpExecTool.execute(
      {
        server: "huckleberry-ts",
        tool: "read_large_result",
        args: { id: "lr_1", page: 1 },
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_kind).toBe("input_error");
    expect(result.result).toContain("top-level Botholomew tool");
    expect(result.hint).toContain('name="read_large_result"');
  });

  test("passes args through to exec", async () => {
    const { ctx } = await setupToolContext();
    const execMock = mock(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      isError: false,
    }));
    ctx.mcpxClient = { exec: execMock } as unknown as McpxClient;

    await mcpExecTool.execute(
      { server: "srv", tool: "fn", args: { key: "val" } },
      ctx,
    );
    expect(execMock).toHaveBeenCalledWith("srv", "fn", { key: "val" });
  });
});
