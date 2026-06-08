import { describe, expect, test } from "bun:test";
import type { Tool } from "@evantahler/mcpx";
import type { ApprovalConfig } from "../../src/config/schemas.ts";
import {
  buildApprovalPolicy,
  matchesAllowlist,
} from "../../src/mcpx/client.ts";

function tool(name: string, annotations?: Tool["annotations"]): Tool {
  return { name, inputSchema: { type: "object" }, annotations } as Tool;
}

function cfg(over: Partial<ApprovalConfig> = {}): {
  approvals: ApprovalConfig;
} {
  return {
    approvals: {
      enabled: true,
      allowed_tools: [],
      auto_allow_read_only: false,
      ...over,
    },
  };
}

describe("matchesAllowlist", () => {
  test("exact server/tool", () => {
    expect(matchesAllowlist(["gmail/send"], "gmail", "send")).toBe(true);
    expect(matchesAllowlist(["gmail/send"], "gmail", "draft")).toBe(false);
    expect(matchesAllowlist(["gmail/send"], "slack", "send")).toBe(false);
  });

  test("wildcards on either side", () => {
    expect(matchesAllowlist(["gmail/*"], "gmail", "anything")).toBe(true);
    expect(matchesAllowlist(["*/search"], "anyserver", "search")).toBe(true);
    expect(matchesAllowlist(["*/search"], "anyserver", "send")).toBe(false);
  });

  test("bare token matches the tool name on any server", () => {
    expect(matchesAllowlist(["search"], "gmail", "search")).toBe(true);
    expect(matchesAllowlist(["search"], "gmail", "send")).toBe(false);
  });

  test("regex form tests the tool name", () => {
    expect(matchesAllowlist(["/^list_/"], "s", "list_files")).toBe(true);
    expect(matchesAllowlist(["/^list_/"], "s", "delete_file")).toBe(false);
    expect(matchesAllowlist(["/SEND/i"], "s", "send_email")).toBe(true);
  });

  test("ignores blanks and invalid regex", () => {
    expect(matchesAllowlist(["", "  "], "s", "t")).toBe(false);
    expect(matchesAllowlist(["/([/"], "s", "t")).toBe(false);
  });
});

describe("buildApprovalPolicy", () => {
  test("undefined when unsafe or disabled (zero-overhead gate-off)", () => {
    expect(buildApprovalPolicy(cfg(), { unsafe: true })).toBeUndefined();
    expect(buildApprovalPolicy(cfg({ enabled: false }))).toBeUndefined();
  });

  test("gates everything by default (empty allowlist)", () => {
    const policy = buildApprovalPolicy(cfg());
    expect(typeof policy).toBe("function");
    const predicate = policy as (t: Tool, s: string) => boolean;
    expect(predicate(tool("send"), "gmail")).toBe(true);
    expect(predicate(tool("read"), "gmail")).toBe(true);
  });

  test("allowlisted tools are not gated", () => {
    const predicate = buildApprovalPolicy(
      cfg({ allowed_tools: ["gmail/read", "*/search"] }),
    ) as (t: Tool, s: string) => boolean;
    expect(predicate(tool("read"), "gmail")).toBe(false);
    expect(predicate(tool("search"), "anything")).toBe(false);
    expect(predicate(tool("send"), "gmail")).toBe(true);
  });

  test("auto_allow_read_only skips read-only tools", () => {
    const predicate = buildApprovalPolicy(
      cfg({ auto_allow_read_only: true }),
    ) as (t: Tool, s: string) => boolean;
    expect(predicate(tool("read", { readOnlyHint: true }), "s")).toBe(false);
    expect(predicate(tool("send", { readOnlyHint: false }), "s")).toBe(true);
    expect(predicate(tool("send"), "s")).toBe(true); // unannotated still gated
  });
});
