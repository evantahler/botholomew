import { z } from "zod";
import { writeCapabilitiesFile } from "../../context/capabilities.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  include_mcp: z
    .boolean()
    .optional()
    .describe(
      "When false, skip MCPX tool enumeration (internal tools only). Defaults to true.",
    ),
});

const outputSchema = z.object({
  path: z.string(),
  internal_tool_count: z.number(),
  mcp_tool_count: z.number(),
  created_file: z.boolean(),
  message: z.string(),
  is_error: z.boolean(),
});

export const capabilitiesRefreshTool = {
  name: "capabilities_refresh",
  description:
    "[[ bash equivalent command: which ]] Rescan every available tool (built-in + configured MCPX servers) and rewrite `persistent-context/capabilities.md`. Call this when you think the inventory is stale — new MCP servers were added, tools were renamed, or the capabilities file was deleted. The regenerated file is automatically loaded into every subsequent system prompt.",
  group: "capabilities",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const includeMcp = input.include_mcp !== false;
    const client = includeMcp ? ctx.mcpxClient : null;
    const result = await writeCapabilitiesFile(
      ctx.projectDir,
      client,
      ctx.config,
    );
    const parts = [
      `${result.counts.internal} internal tool(s)`,
      `${result.counts.mcp} MCPX tool(s)`,
    ];
    if (!includeMcp) parts.push("MCPX skipped");
    if (result.createdFile) parts.push("file created");
    return {
      path: result.path,
      internal_tool_count: result.counts.internal,
      mcp_tool_count: result.counts.mcp,
      created_file: result.createdFile,
      message: `Wrote capabilities.md (${parts.join(", ")})`,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
