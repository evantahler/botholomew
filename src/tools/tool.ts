import type { McpxClient } from "@evantahler/mcpx";
import type { z } from "zod";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { WithMem } from "../mem/client.ts";

export interface ToolContext {
  /**
   * Scope-bound membot accessor. Each `membot_*` tool wraps its work in
   * `ctx.withMem((mem) => mem.<op>(...))`. Backed by `sharedWithMem` inside a
   * chat turn / worker tick (one connection, many ops) or `scopedWithMem` in
   * sparse callers like the TUI panel (open per op, release the DuckDB file
   * lock between calls).
   */
  withMem: WithMem;
  projectDir: string;
  config: BotholomewConfig;
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
  /**
   * Worker-mode only. Called by `mcp_exec` when a gated mcpx call has no
   * decision yet and a pending `approvals/<id>.md` was written. The worker
   * loop records the id and parks the task as `waiting` after the turn.
   * Chat leaves this `undefined` (chat resolves approvals inline).
   */
  onApprovalPending?: (approvalId: string) => void;
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
