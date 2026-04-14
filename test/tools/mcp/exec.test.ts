import { describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { mcpExecTool } from "../../../src/tools/mcp/exec.ts";
import { setupToolContext } from "../../helpers.ts";

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
    const { ctx } = setupToolContext();
    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.result).toContain("No MCP servers configured");
  });

  test("executes tool and returns formatted result", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = mockClient({
      content: [{ type: "text", text: "Email sent successfully" }],
    });

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email", args: { to: "test@test.com" } },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.result).toBe("Email sent successfully");
  });

  test("propagates isError from tool result", async () => {
    const { ctx } = setupToolContext();
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
  });

  test("handles exec throwing", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      exec: mock(async () => {
        throw new Error("Connection refused");
      }),
    } as unknown as McpxClient;

    const result = await mcpExecTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.result).toContain("Connection refused");
  });

  test("passes args through to exec", async () => {
    const { ctx } = setupToolContext();
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
