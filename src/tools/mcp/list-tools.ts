import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  server: z
    .string()
    .optional()
    .describe("Filter tools to a specific MCP server name"),
});

const ToolEntrySchema = z.object({
  server: z.string(),
  name: z.string(),
  description: z.string(),
});

const outputSchema = z.object({
  tools: z.array(ToolEntrySchema),
  is_error: z.boolean(),
  hint: z.string().optional(),
});

export const mcpListToolsTool = {
  name: "mcp_list_tools",
  description:
    "List available tools from configured MCP servers. Optionally filter by server name.",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    if (!ctx.mcpxClient) {
      return {
        tools: [],
        is_error: false,
        hint: "No MCP servers configured. Add servers with `botholomew mcpx add`.",
      };
    }

    const toolsWithServer = await ctx.mcpxClient.listTools(input.server);
    const mapped = toolsWithServer.map((t) => ({
      server: t.server,
      name: t.tool.name,
      description: t.tool.description ?? "",
    }));
    return {
      tools: mapped,
      is_error: false,
      hint:
        mapped.length > 0
          ? "Use mcp_search to find tools by capability, or mcp_info to get the full schema for a specific tool."
          : "No tools available. MCP servers may not be configured or may be offline.",
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
