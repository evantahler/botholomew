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
  path: z.string().nullable(),
  internal_tool_count: z.number(),
  mcp_tool_count: z.number(),
  created_file: z.boolean(),
  message: z.string(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const capabilitiesRefreshTool = {
  name: "capabilities_refresh",
  description:
    "[[ bash equivalent command: which ]] Rescan every available tool (built-in + configured MCPX servers) and rewrite `prompts/capabilities.md`. Call this when you think the inventory is stale — new MCP servers were added, tools were renamed, or the capabilities file was deleted. The regenerated file is automatically loaded into every subsequent system prompt.",
  group: "capabilities",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const includeMcp = input.include_mcp !== false;
    const client = includeMcp ? ctx.mcpxClient : null;
    try {
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
    } catch (err) {
      // writeCapabilitiesFile may call out to Anthropic for a thematic
      // summary; transient API errors shouldn't crash the agent loop.
      // The static fallback path inside generateCapabilitiesMarkdown
      // already covers the no-key case, so getting here means an
      // unexpected I/O or LLM failure.
      return {
        path: null,
        internal_tool_count: 0,
        mcp_tool_count: 0,
        created_file: false,
        message: err instanceof Error ? err.message : String(err),
        is_error: true,
        error_type: "refresh_failed",
        next_action_hint:
          "Try again later or pass include_mcp=false to skip the MCPX enumeration.",
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
