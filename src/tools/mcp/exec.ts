import { z } from "zod";
import { formatCallToolResult } from "../../mcpx/client.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  server: z.string().describe("MCP server name"),
  tool: z.string().describe("Tool name on the server"),
  args: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Tool arguments as a JSON object"),
});

const outputSchema = z.object({
  result: z.string(),
  is_error: z.boolean(),
});

export const mcpExecTool = {
  name: "mcp_exec",
  description:
    "Execute a tool on an MCP server. Use mcp_list_tools or mcp_search to discover available tools first.",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!ctx.mcpxClient) {
      return {
        result:
          "No MCP servers configured. Add servers with `botholomew mcpx add`.",
        is_error: true,
      };
    }

    try {
      const callResult = await ctx.mcpxClient.exec(
        input.server,
        input.tool,
        input.args,
      );
      return {
        result: formatCallToolResult(callResult),
        is_error: callResult.isError ?? false,
      };
    } catch (err) {
      return {
        result: `MCP tool error: ${err}`,
        is_error: true,
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
