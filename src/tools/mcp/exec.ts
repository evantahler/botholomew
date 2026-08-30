import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import { dispatchMcpExec } from "./dispatch.ts";

const inputSchema = z.object({
  server: z.string().describe("MCP server name"),
  tool: z.string().describe("Tool name on the server"),
  args: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Tool arguments as a JSON object"),
});

const errorKindSchema = z
  .enum(["retryable", "permanent", "input_error", "auth_error"])
  .optional();

const outputSchema = z.object({
  result: z.string(),
  is_error: z.boolean(),
  error_kind: errorKindSchema,
  hint: z.string().optional(),
});

export const mcpExecTool = {
  name: "mcp_exec",
  description:
    "Execute a tool on an MCP server. Use mcp_list_tools or mcp_search to discover available tools first, and mcp_info to check the expected input schema.",
  group: "mcp",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const dispatched = await dispatchMcpExec(input, ctx);
    if (dispatched.ok) {
      return {
        result: dispatched.result,
        is_error: false,
        error_kind: undefined,
        hint: undefined,
      };
    }
    return {
      result: dispatched.result,
      is_error: true,
      error_kind: dispatched.error_kind,
      hint: dispatched.hint,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
