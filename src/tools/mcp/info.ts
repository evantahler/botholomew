import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  server: z.string().describe("MCP server name"),
  tool: z.string().describe("Tool name to describe"),
});

const outputSchema = z.object({
  found: z.boolean(),
  name: z.string(),
  description: z.string(),
  input_schema: z.string(),
  is_error: z.boolean(),
});

export const mcpInfoTool = {
  name: "mcp_info",
  description:
    "Get the full schema (name, description, input parameters) for a specific MCP tool. Use this before calling mcp_exec to understand the required arguments.",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!ctx.mcpxClient) {
      return {
        found: false,
        name: input.tool,
        description: "No MCP servers configured.",
        input_schema: "{}",
        is_error: true,
      };
    }

    const tool = await ctx.mcpxClient.info(input.server, input.tool);
    if (!tool) {
      return {
        found: false,
        name: input.tool,
        description: `Tool "${input.tool}" not found on server "${input.server}".`,
        input_schema: "{}",
        is_error: true,
      };
    }

    return {
      found: true,
      name: tool.name,
      description: tool.description ?? "",
      input_schema: JSON.stringify(tool.inputSchema ?? {}, null, 2),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
