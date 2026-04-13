import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { DuckDBConnection } from "../db/connection.ts";

export interface ToolContext {
  conn: DuckDBConnection;
  projectDir: string;
  config: Required<BotholomewConfig>;
}

export interface ToolDefinition<
  TInput extends z.ZodObject,
  TOutput extends z.ZodType,
> {
  name: string;
  description: string;
  group: string;
  terminal?: boolean;
  inputSchema: TInput;
  outputSchema: TOutput;
  execute: (
    input: z.infer<TInput>,
    ctx: ToolContext,
  ) => Promise<z.infer<TOutput>>;
}

// --- Registry ---

const tools = new Map<string, ToolDefinition<any, any>>();

export function registerTool(tool: ToolDefinition<any, any>): void {
  tools.set(tool.name, tool);
}

export function registerTools(toolList: ToolDefinition<any, any>[]): void {
  for (const tool of toolList) {
    registerTool(tool);
  }
}

export function getTool(name: string): ToolDefinition<any, any> | undefined {
  return tools.get(name);
}

export function getAllTools(): ToolDefinition<any, any>[] {
  return Array.from(tools.values());
}

export function getToolsByGroup(group: string): ToolDefinition<any, any>[] {
  return getAllTools().filter((t) => t.group === group);
}

// --- Anthropic adapter ---

export function toAnthropicTool(tool: ToolDefinition<any, any>): AnthropicTool {
  const jsonSchema = z.toJSONSchema(tool.inputSchema);
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: jsonSchema.properties ?? {},
      required: jsonSchema.required as string[] | undefined,
    },
  };
}

export function toAnthropicTools(): AnthropicTool[] {
  return getAllTools().map(toAnthropicTool);
}
