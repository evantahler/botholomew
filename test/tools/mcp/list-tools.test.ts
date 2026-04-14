import { describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { mcpListToolsTool } from "../../../src/tools/mcp/list-tools.ts";
import { setupToolContext } from "../../helpers.ts";

function mockClient(
  tools: Array<{ server: string; name: string; description: string }>,
): McpxClient {
  return {
    listTools: mock(async (server?: string) => {
      const filtered = server
        ? tools.filter((t) => t.server === server)
        : tools;
      return filtered.map((t) => ({
        server: t.server,
        tool: { name: t.name, description: t.description },
      }));
    }),
  } as unknown as McpxClient;
}

describe("mcp_list_tools", () => {
  test("returns empty array when mcpxClient is null", async () => {
    const { ctx } = setupToolContext();
    const result = await mcpListToolsTool.execute({}, ctx);
    expect(result.tools).toEqual([]);
  });

  test("lists all tools from all servers", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = mockClient([
      { server: "gmail", name: "send_email", description: "Send email" },
      { server: "slack", name: "post_message", description: "Post message" },
    ]);

    const result = await mcpListToolsTool.execute({}, ctx);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toEqual({
      server: "gmail",
      name: "send_email",
      description: "Send email",
    });
  });

  test("filters by server name", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = mockClient([
      { server: "gmail", name: "send_email", description: "Send email" },
      { server: "slack", name: "post_message", description: "Post message" },
    ]);

    const result = await mcpListToolsTool.execute({ server: "gmail" }, ctx);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.server).toBe("gmail");
  });
});
