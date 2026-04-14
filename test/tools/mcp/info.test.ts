import { describe, expect, mock, test } from "bun:test";
import type { McpxClient } from "@evantahler/mcpx";
import { mcpInfoTool } from "../../../src/tools/mcp/info.ts";
import { setupToolContext } from "../../helpers.ts";

describe("mcp_info", () => {
  test("returns not found when mcpxClient is null", async () => {
    const { ctx } = setupToolContext();
    const result = await mcpInfoTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.found).toBe(false);
    expect(result.description).toContain("No MCP servers configured");
  });

  test("returns not found for unknown tool", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      info: mock(async () => undefined),
    } as unknown as McpxClient;

    const result = await mcpInfoTool.execute(
      { server: "gmail", tool: "nonexistent" },
      ctx,
    );
    expect(result.found).toBe(false);
    expect(result.description).toContain("not found");
  });

  test("returns tool schema when found", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      info: mock(async () => ({
        name: "send_email",
        description: "Send an email message",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient" },
            subject: { type: "string", description: "Subject line" },
            body: { type: "string", description: "Email body" },
          },
          required: ["to", "subject", "body"],
        },
      })),
    } as unknown as McpxClient;

    const result = await mcpInfoTool.execute(
      { server: "gmail", tool: "send_email" },
      ctx,
    );
    expect(result.found).toBe(true);
    expect(result.name).toBe("send_email");
    expect(result.description).toBe("Send an email message");
    const schema = JSON.parse(result.input_schema);
    expect(schema.properties.to.type).toBe("string");
    expect(schema.required).toContain("to");
  });

  test("handles tool with no inputSchema", async () => {
    const { ctx } = setupToolContext();
    ctx.mcpxClient = {
      info: mock(async () => ({
        name: "ping",
        description: "Ping the server",
      })),
    } as unknown as McpxClient;

    const result = await mcpInfoTool.execute(
      { server: "health", tool: "ping" },
      ctx,
    );
    expect(result.found).toBe(true);
    expect(result.input_schema).toBe("{}");
  });
});
