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
  TInput extends z.ZodObject<z.ZodRawShape>,
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

export type AnyToolDefinition = ToolDefinition<
  z.ZodObject<z.ZodRawShape>,
  z.ZodType
>;

const tools = new Map<string, AnyToolDefinition>();

export function registerTool<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType,
>(tool: ToolDefinition<TInput, TOutput>): void {
  tools.set(tool.name, tool as unknown as AnyToolDefinition);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return tools.get(name);
}

export function getAllTools(): AnyToolDefinition[] {
  return Array.from(tools.values());
}

export function getToolsByGroup(group: string): AnyToolDefinition[] {
  return getAllTools().filter((t) => t.group === group);
}

// --- Anthropic adapter ---

export function toAnthropicTool(tool: AnyToolDefinition): AnthropicTool {
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
