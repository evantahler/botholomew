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
  test("returns empty results with hint when mcpxClient is null", async () => {
    const { ctx } = setupToolContext();
    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toEqual([]);
    expect(result.hint).toContain("No MCP servers configured");
  });

  test("returns search results with next-action hint", async () => {
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
    expect(result.hint).toContain("mcp_info");
  });

  test("returns hint for empty results", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = mockClient([]);

    const result = await mcpSearchTool.execute({ query: "nonexistent" }, ctx);
    expect(result.results).toEqual([]);
    expect(result.is_error).toBe(false);
    expect(result.hint).toContain("mcp_list_tools");
  });

  test("returns error_message when search index is missing", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      search: mock(async () => {
        throw new Error("Search index not found");
      }),
    } as unknown as McpxClient;

    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toEqual([]);
    expect(result.is_error).toBe(true);
    expect(result.error_message).toContain("Search index not built");
    expect(result.hint).toContain("mcp_list_tools");
  });

  test("returns error_message for generic search failure", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      search: mock(async () => {
        throw new Error("Something broke");
      }),
    } as unknown as McpxClient;

    const result = await mcpSearchTool.execute({ query: "email" }, ctx);
    expect(result.results).toEqual([]);
    expect(result.is_error).toBe(true);
    expect(result.error_message).toContain("Search failed");
    expect(result.hint).toContain("fallback");
  });
});
