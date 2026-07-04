import { describe, expect, test } from "bun:test";
import {
  type BotholomewConfig,
  DEFAULT_CONFIG,
  type NotifyChannel,
} from "../../src/config/schemas.ts";
import { notifyTool } from "../../src/tools/notify/send.ts";
import type { ToolContext } from "../../src/tools/tool.ts";

function ctx(
  channels: NotifyChannel[],
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    withMem: null as never,
    projectDir: "/tmp",
    config: {
      ...DEFAULT_CONFIG,
      notify: { ...DEFAULT_CONFIG.notify, channels },
    } as BotholomewConfig,
    mcpxClient: null,
    ...overrides,
  };
}

describe("notify tool", () => {
  // Desktop delivery is suppressed under NODE_ENV=test but still reported as
  // delivered, so it's a deterministic stand-in for a working channel.
  test("returns delivered_channels on success", async () => {
    const out = await notifyTool.execute(
      { title: "Done", message: "Report ready", severity: "info" },
      ctx([{ type: "desktop" }]),
    );
    expect(out.is_error).toBe(false);
    expect(out.delivered_channels).toEqual(["desktop"]);
  });

  test("is_error with a hint when no channels are configured", async () => {
    const out = await notifyTool.execute(
      { title: "x", message: "y", severity: "info" },
      ctx([]),
    );
    expect(out.is_error).toBe(true);
    expect(out.delivered_channels).toEqual([]);
    expect(out.next_action_hint).toBeDefined();
  });

  test("routes side-effect message through ctx.notify when present", async () => {
    const seen: string[] = [];
    await notifyTool.execute(
      { title: "Heads up", message: "y", severity: "warning" },
      ctx([{ type: "desktop" }], { notify: (m) => seen.push(m) }),
    );
    expect(seen).toEqual(["Notified user: Heads up"]);
  });
});
