import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";
import {
  invokeSandbox,
  persistInterruptedRun,
  RUN_ERROR_TYPES,
  type RunHelp,
  type RunToolOutput,
} from "./run/execute.ts";
import { DEFAULT_MAX_INPUT_BYTES, PREVIEW_CHARS } from "./run/limits.ts";
import { HOST_API_PRIMER } from "./run/primer.ts";

const inputSchema = z.object({
  source: z
    .string()
    .describe(
      'JavaScript or type-stripped TypeScript function body run in a QuickJS sandbox. Top-level await and return are supported. Globals: files.* (membot index) and mcp.* (approval-gated MCP). Return a small value, or write large output with files.writeJson / output_logical_path. Pass "?" for the host API reference.',
    ),
  output_logical_path: z
    .string()
    .optional()
    .describe(
      "If set, write the returned value here as JSON and return only a storage ack.",
    ),
  change_note: z
    .string()
    .optional()
    .describe(
      "Free-text note attached to the new version when output_logical_path is set.",
    ),
  max_input_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `Reject a files.readJson / files.readText source if it exceeds this many characters (default ${DEFAULT_MAX_INPUT_BYTES}).`,
    ),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  result: z.unknown().optional(),
  result_type: z
    .enum(["array", "object", "string", "number", "boolean", "null"])
    .optional(),
  result_count: z.number().optional(),
  logical_path: z.string().optional(),
  version_id: z.string().optional(),
  bytes_written: z.number().optional(),
  preview: z
    .string()
    .optional()
    .describe(`First ${PREVIEW_CHARS} characters of the stored output.`),
  error_type: z.enum(RUN_ERROR_TYPES).optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const membotRunTool = {
  name: "membot_run",
  description:
    "[[ bash equivalent command: bun -e '<source>' ]] Run sandboxed TypeScript against the membot index (files.*) and approval-gated MCP tools (mcp.*) WITHOUT loading large blobs into context. Return a small value, or write with files.writeJson / output_logical_path. Pair with membot_pipe or mcp.capture for large dumps. Pass source=\"?\" for the host API. No Node, filesystem, fetch, or shell.",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx): Promise<RunToolOutput> => {
    const source = input.source.trim();
    if (source === "" || source === "?") {
      const help: RunHelp = { is_error: false, message: HOST_API_PRIMER };
      return help;
    }

    const invocation = {
      source,
      output_logical_path: input.output_logical_path,
      change_note: input.change_note,
      max_input_bytes: input.max_input_bytes,
    };

    let outcome = await invokeSandbox(ctx, invocation);

    while (outcome.status === "interrupted") {
      if (ctx.requestApprovals) {
        const decisions = await ctx.requestApprovals(
          outcome.interruptions.map((i) => ({
            server: i.payload.server,
            tool: i.payload.tool,
            args: i.payload.args,
            reason: i.payload.message,
          })),
        );
        outcome = await invokeSandbox(ctx, {
          ...invocation,
          continuation: outcome.continuation,
          continuationContext: outcome.continuationContext,
          resolutions: outcome.interruptions.map((interruption, idx) => ({
            interruptionId: interruption.id,
            value: decisions[idx] === true,
          })),
        });
        continue;
      }

      const persisted = await persistInterruptedRun(ctx, invocation, outcome);
      ctx.onApprovalPending?.(persisted.approvalIds[0] ?? persisted.runId);
      return {
        is_error: true,
        error_type: "approval_pending",
        message: `This program is queued for human approval (run ${persisted.runId}; approvals ${persisted.approvalIds.join(", ")}).`,
        next_action_hint:
          "Await the human decision. The worker will resume this exact program — do not write a new one. Call wait_task if you are a worker.",
      };
    }

    if (outcome.status === "failed") return outcome.output;
    return outcome.output;
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
