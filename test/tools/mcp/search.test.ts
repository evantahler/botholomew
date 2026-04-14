import { describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { mcpSearchTool } from "../../../src/tools/mcp/search.ts";
import { setupToolContext } from "../../helpers.ts";

function mockClient(
  results: Array<{
    server: string;
    tool: string;
    description: string;
    score: number;
    matchType?: string;
  }>,
): McpxClient {
  return {
    search: mock(async () => results),
  } as unknown as McpxClient;
}

describe("mcp_search", () => {
  test("returns empty results when mcpxClient is null", async () => {
    const { ctx } = setupToolContext();
    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toEqual([]);
  });

  test("returns search results", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = mockClient([
      {
        server: "gmail",
        tool: "send_email",
        description: "Send email",
        score: 0.95,
        matchType: "both",
      },
    ]);

    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      server: "gmail",
      tool: "send_email",
      description: "Send email",
      score: 0.95,
      match_type: "both",
    });
  });

  test("returns empty results when search throws", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      search: mock(async () => {
        throw new Error("No search index");
      }),
    } as unknown as McpxClient;

    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toEqual([]);
  });
});
