import { describe, expect, test } from "bun:test";
import {
  type BotholomewConfig,
  DEFAULT_CONFIG,
  type NotifyChannel,
} from "../../src/config/schemas.ts";
import {
  channelLabel,
  dispatchNotification,
  dispatchToChannels,
  maybeNotifyEvent,
  type Notification,
} from "../../src/notify/dispatch.ts";

const desktop: NotifyChannel = { type: "desktop" };
const mcpxChannel: NotifyChannel = {
  type: "mcpx",
  server: "slack",
  tool: "send",
  args: { text: "{{message}}" },
};

function configWith(
  notify: Partial<BotholomewConfig["notify"]>,
): BotholomewConfig {
  return {
    ...DEFAULT_CONFIG,
    notify: { ...DEFAULT_CONFIG.notify, ...notify },
  };
}

const note: Notification = { title: "t", message: "m" };

describe("channelLabel", () => {
  test("labels desktop and mcpx channels", () => {
    expect(channelLabel(desktop)).toBe("desktop");
    expect(channelLabel(mcpxChannel)).toBe("mcpx:slack/send");
  });
});

describe("dispatchToChannels", () => {
  test("fans out to every channel and records delivered labels", async () => {
    const seen: NotifyChannel[] = [];
    const result = await dispatchToChannels(
      [desktop, mcpxChannel],
      async (c) => {
        seen.push(c);
      },
    );
    expect(seen).toHaveLength(2);
    expect(result.delivered).toEqual(["desktop", "mcpx:slack/send"]);
    expect(result.failed).toEqual([]);
  });

  test("a failing channel is swallowed; others still deliver", async () => {
    const result = await dispatchToChannels(
      [desktop, mcpxChannel],
      async (c) => {
        if (c.type === "desktop") throw new Error("desktop boom");
      },
    );
    expect(result.delivered).toEqual(["mcpx:slack/send"]);
    expect(result.failed).toEqual([
      { channel: "desktop", error: "desktop boom" },
    ]);
  });
});

describe("dispatchNotification", () => {
  test("is a no-op when notifications are disabled", async () => {
    const result = await dispatchNotification(
      note,
      configWith({ enabled: false, channels: [desktop] }),
      { projectDir: "/tmp" },
    );
    expect(result.delivered).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test("delivers via the desktop channel (suppressed under NODE_ENV=test)", async () => {
    const result = await dispatchNotification(
      note,
      configWith({ channels: [desktop] }),
      { projectDir: "/tmp" },
    );
    expect(result.delivered).toEqual(["desktop"]);
  });

  test("honors an explicit channels override", async () => {
    const result = await dispatchNotification(
      note,
      configWith({ channels: [desktop] }),
      { projectDir: "/tmp", channels: [] },
    );
    expect(result.delivered).toEqual([]);
  });
});

describe("maybeNotifyEvent", () => {
  const events = {
    task_failed: true,
    task_quarantined: true,
    schedule_errored: true,
  };

  test("dispatches when the event toggle is on", async () => {
    const result = await maybeNotifyEvent(
      "/tmp",
      configWith({ channels: [desktop], events }),
      "task_failed",
      note,
    );
    expect(result).not.toBeNull();
    expect(result?.delivered).toEqual(["desktop"]);
  });

  test("returns null (skips) when the event toggle is off", async () => {
    const result = await maybeNotifyEvent(
      "/tmp",
      configWith({
        channels: [desktop],
        events: { ...events, task_failed: false },
      }),
      "task_failed",
      note,
    );
    expect(result).toBeNull();
  });

  test("returns null when notifications are disabled entirely", async () => {
    const result = await maybeNotifyEvent(
      "/tmp",
      configWith({ enabled: false, channels: [desktop], events }),
      "task_failed",
      note,
    );
    expect(result).toBeNull();
  });
});
