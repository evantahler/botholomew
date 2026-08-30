import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { decideApproval } from "../../../src/approvals/store.ts";
import { findRunContinuationForTask } from "../../../src/tools/membot/run/continuation.ts";
import { resumeStoredRun } from "../../../src/tools/membot/run/execute.ts";
import { membotRunTool } from "../../../src/tools/membot/run.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

describe("membot_run worker resume", () => {
  test("replays the same program after approval without a second exec of prior work", async () => {
    const exec = mock(async () => ({
      content: [{ type: "text", text: '{"sent":true}' }],
      isError: false,
    }));
    ctx.approvalGateActive = true;
    ctx.taskId = "task-resume-1";
    ctx.mcpxClient = {
      info: mock(async () => ({
        name: "send_email",
        description: "Send",
        inputSchema: {},
      })),
      exec,
    } as unknown as McpxClient;

    const first = await membotRunTool.execute(
      {
        source: `
          const listed = await files.exists("missing.json");
          const sent = await mcp.exec("gmail", "send_email", { to: "a@b.c" });
          return { listed, sent };
        `,
      },
      ctx,
    );
    expect(first).toMatchObject({
      is_error: true,
      error_type: "approval_pending",
    });
    expect(exec).toHaveBeenCalledTimes(0);

    const stored = await findRunContinuationForTask(
      ctx.projectDir,
      "task-resume-1",
    );
    expect(stored).not.toBeNull();
    if (!stored) return;

    await decideApproval(
      ctx.projectDir,
      stored.approval_ids[0] as string,
      "approved",
      "tester",
    );

    const outcome = await resumeStoredRun(ctx, stored);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: { listed: false, sent: { sent: true } },
    });
    expect(exec).toHaveBeenCalledTimes(1);

    expect(
      await findRunContinuationForTask(ctx.projectDir, "task-resume-1"),
    ).toBeNull();
  });

  test("rejects a tampered continuation", async () => {
    ctx.approvalGateActive = true;
    ctx.taskId = "task-tamper";
    ctx.mcpxClient = {
      info: mock(async () => ({
        name: "send_email",
        description: "Send",
        inputSchema: {},
      })),
      exec: mock(async () => ({ content: [], isError: false })),
    } as unknown as McpxClient;

    await membotRunTool.execute(
      { source: `return await mcp.exec("gmail", "send_email", {});` },
      ctx,
    );
    const stored = await findRunContinuationForTask(
      ctx.projectDir,
      "task-tamper",
    );
    expect(stored).not.toBeNull();
    if (!stored) return;
    stored.continuation = `${stored.continuation}tampered`;
    const outcome = await resumeStoredRun(ctx, stored);
    expect(outcome.status).toBe("failed");
  });
});
