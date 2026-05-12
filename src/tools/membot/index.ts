import { OPERATIONS } from "membot";
import { type AnyToolDefinition, registerTool } from "../tool.ts";
import { adaptOperation } from "./adapter.ts";
import { membotCopyTool } from "./copy.ts";
import { membotCountLinesTool } from "./count_lines.ts";
import { membotEditTool } from "./edit.ts";
import { membotExistsTool } from "./exists.ts";
import { membotPipeTool } from "./pipe.ts";

/**
 * Register every membot operation as a Botholomew tool. The 14 verbs that
 * have a direct membot Operation (add, list, tree, read, search, info,
 * stats, versions, diff, write, move, delete, refresh, prune) are wired via
 * `adaptOperation`; the five Botholomew-side wrappers (edit, copy, exists,
 * count_lines, pipe) bolt on the file-shaped UX our agents already know.
 */
export function registerMembotTools(): void {
  for (const op of OPERATIONS) {
    registerTool(adaptOperation(op) as unknown as AnyToolDefinition);
  }
  registerTool(membotEditTool);
  registerTool(membotCopyTool);
  registerTool(membotExistsTool);
  registerTool(membotCountLinesTool);
  registerTool(membotPipeTool);
}
