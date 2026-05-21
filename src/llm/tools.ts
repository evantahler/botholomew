import { type Tool, type ToolSet, tool } from "ai";
import type { z } from "zod";
import type { AnyToolDefinition } from "../tools/tool.ts";

/**
 * Convert a Botholomew `ToolDefinition` into an AI-SDK `Tool`. We deliberately
 * do NOT wire the `execute` function: our turn loop runs tools itself so we can
 * keep max_turns, parallel execution, queued user injections, terminal worker
 * tools, and the soft-error (`is_error`) convention working consistently.
 */
export function toAiSdkTool(def: AnyToolDefinition): Tool {
  return tool({
    description: def.description,
    inputSchema: def.inputSchema as z.ZodType,
  });
}

export function toAiSdkTools(defs: AnyToolDefinition[]): ToolSet {
  const out: Record<string, Tool> = {};
  for (const def of defs) {
    out[def.name] = toAiSdkTool(def);
  }
  return out as ToolSet;
}
