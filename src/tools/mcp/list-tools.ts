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
      return { tools: [], is_error: false };
    }

    const toolsWithServer = await ctx.mcpxClient.listTools(input.server);
    return {
      tools: toolsWithServer.map((t) => ({
        server: t.server,
        name: t.tool.name,
        description: t.tool.description ?? "",
      })),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
