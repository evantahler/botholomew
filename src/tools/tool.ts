import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages";
import type { McpxClient } from "@evantahler/mcpx";
import type { MembotClient } from "membot";
import { z } from "zod";
import type { BotholomewConfig } from "../config/schemas.ts";

export interface ToolContext {
  /**
   * Per-process membot client. Backs every `membot_*` tool. Membot manages
   * its own DuckDB connection lifecycle internally (lazy claim, release
   * between operations), so tools just call `ctx.mem.<op>(...)` directly —
   * no per-call open/close needed.
   */
  mem: MembotClient;
  projectDir: string;
  config: Required<BotholomewConfig>;
  mcpxClient: McpxClient | null;
  /**
   * Identifier of the agent process running this tool, used as the holder
   * id for per-path context locks (`src/context/locks.ts`) so the worker
   * reaper can identify and release locks abandoned by a crashed worker.
   * Workers pass their `workerId`; chat sessions pass a `chat:` prefixed
   * id; tests and one-off CLI calls leave it `undefined` (the store falls
   * back to `pid:<n>`).
   */
  workerId?: string;
  /**
   * Chat-mode only. Lets long-running tools (e.g. `sleep`) poll for
   * Esc-to-abort by reading `session.aborted`. Workers leave this `undefined`.
   */
  shouldAbort?: () => boolean;
  /**
   * Chat-mode only. Tools call this to surface a short human-readable
   * side-effect message (e.g. "Created subtask: …") that the TUI renders
   * inside the tool-call card. Workers leave this `undefined`; tools fall
   * back to `logger.info` so worker logs are unchanged.
   */
  notify?: (message: string) => void;
}

type ToolOutputBase = { is_error: z.ZodBoolean };

export interface ToolDefinition<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodObject<z.ZodRawShape & ToolOutputBase>,
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
  z.ZodObject<z.ZodRawShape & ToolOutputBase>
>;

const tools = new Map<string, AnyToolDefinition>();

export function registerTool<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodObject<z.ZodRawShape & ToolOutputBase>,
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
