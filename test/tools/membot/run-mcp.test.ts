import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { findRunContinuationForTask } from "../../../src/tools/membot/run/continuation.ts";
import { membotRunTool } from "../../../src/tools/membot/run.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let ctx: ToolContext;
let cleanup: () => Promise<void>;

function toolSchema() {
  return {
    name: "send_email",
    description: "Send an email",
    inputSchema: { type: "object" },
  };
}

beforeEach(async () => {
  ({ ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

describe("membot_run mcp host", () => {
  test("mcp.exec returns parsed JSON when ungated", async () => {
    const exec = mock(async () => ({
      content: [{ type: "text", text: '{"ok":true,"n":3}' }],
      isError: false,
    }));
    ctx.mcpxClient = { exec } as unknown as McpxClient;
    ctx.approvalGateActive = false;

    const r = await membotRunTool.execute(
      {
        source: `return await mcp.exec("gmail", "list", { q: "x" });`,
      },
      ctx,
    );
    expect(r).toMatchObject({ is_error: false, result: { ok: true, n: 3 } });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("mcp.capture writes the payload and returns an ack", async () => {
    ctx.mcpxClient = {
      exec: mock(async () => ({
        content: [{ type: "text", text: '{"items":[1,2,3]}' }],
        isError: false,
      })),
    } as unknown as McpxClient;
    ctx.approvalGateActive = false;

    const r = await membotRunTool.execute(
      {
        source: `return await mcp.capture("gmail", "list", {}, "mcp/dump.json");`,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: false,
      result: {
        logical_path: "mcp/dump.json",
        size_bytes: expect.any(Number),
      },
    });
  });

  test("gated mcp.exec interrupts and parks a worker continuation", async () => {
    ctx.approvalGateActive = true;
    ctx.taskId = "task-run-1";
    ctx.threadId = "thread-1";
    ctx.mcpxClient = {
      info: mock(async () => toolSchema()),
      exec: mock(async () => {
        throw new Error("should not exec before approval");
      }),
    } as unknown as McpxClient;
    let pending: string | undefined;
    ctx.onApprovalPending = (id) => {
      pending = id;
    };

    const r = await membotRunTool.execute(
      {
        source: `return await mcp.exec("gmail", "send_email", { to: "a@b.c" });`,
      },
      ctx,
    );
    expect(r).toMatchObject({
      is_error: true,
      error_type: "approval_pending",
    });
    expect(pending).toBeDefined();
    const stored = await findRunContinuationForTask(
      ctx.projectDir,
      "task-run-1",
    );
    expect(stored).not.toBeNull();
    expect(stored?.source).toContain("mcp.exec");
  });

  test("chat requestApprovals resume executes once after approve", async () => {
    const exec = mock(async () => ({
      content: [{ type: "text", text: '{"sent":true}' }],
      isError: false,
    }));
    ctx.approvalGateActive = true;
    ctx.mcpxClient = {
      info: mock(async () => toolSchema()),
      exec,
    } as unknown as McpxClient;
    ctx.requestApprovals = async (reqs) => {
      expect(reqs).toHaveLength(1);
      expect(reqs[0]?.server).toBe("gmail");
      return [true];
    };

    const r = await membotRunTool.execute(
      {
        source: `return await mcp.exec("gmail", "send_email", { to: "a@b.c" });`,
      },
      ctx,
    );
    expect(r).toMatchObject({ is_error: false, result: { sent: true } });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("denied chat approval never executes the MCP call", async () => {
    const exec = mock(async () => ({
      content: [{ type: "text", text: "nope" }],
      isError: false,
    }));
    ctx.approvalGateActive = true;
    ctx.mcpxClient = {
      info: mock(async () => toolSchema()),
      exec,
    } as unknown as McpxClient;
    ctx.requestApprovals = async () => [false];

    const r = await membotRunTool.execute(
      {
        source: `return await mcp.exec("gmail", "send_email", { to: "a@b.c" });`,
      },
      ctx,
    );
    expect(r).toMatchObject({ is_error: true, error_type: "mcp_error" });
    expect(r.is_error && r.message).toContain("denied");
    expect(exec).toHaveBeenCalledTimes(0);
  });

  test("rejects wrapping a top-level Botholomew tool", async () => {
    ctx.approvalGateActive = false;
    ctx.mcpxClient = {
      exec: mock(async () => ({ content: [], isError: false })),
    } as unknown as McpxClient;
    const { registerAllTools } = await import("../../../src/tools/registry.ts");
    registerAllTools();
    const r = await membotRunTool.execute(
      {
        source: `return await mcp.exec("gmail", "membot_read", {});`,
      },
      ctx,
    );
    expect(r).toMatchObject({ is_error: true, error_type: "mcp_error" });
  });
});
