import {
  RunError,
  type RunInterruption,
  type RunLimits,
  type RunResolution,
  type RunResult,
} from "run";
import { createApproval, listApprovals } from "../../../approvals/store.ts";
import type { ToolContext } from "../../tool.ts";
import {
  deleteRunContinuation,
  newRunId,
  type StoredRunContinuation,
  writeRunContinuation,
} from "./continuation.ts";
import { hintForHostError, isHostErrorType } from "./errors.ts";
import { buildHostFunctions } from "./host.ts";
import {
  createProjectRunner,
  DEFAULT_MAX_INPUT_BYTES,
  PREVIEW_CHARS,
} from "./limits.ts";
import { HOST_API_PRIMER } from "./primer.ts";

export const RUN_ERROR_TYPES = [
  "invalid_source",
  "sandbox_timeout",
  "sandbox_memory",
  "sandbox_limit",
  "host_error",
  "source_not_found",
  "source_too_large",
  "invalid_json",
  "mcp_error",
  "approval_pending",
  "write_failed",
  "internal_error",
] as const;

export type RunErrorType = (typeof RUN_ERROR_TYPES)[number];

export interface RunHelp {
  is_error: false;
  message: string;
}

export interface RunSuccessInline {
  is_error: false;
  result: unknown;
  result_type: "array" | "object" | "string" | "number" | "boolean" | "null";
  result_count?: number;
}

export interface RunSuccessWrite {
  is_error: false;
  logical_path: string;
  version_id: string;
  bytes_written: number;
  preview: string;
}

export interface RunFailure {
  is_error: true;
  error_type: RunErrorType;
  message: string;
  next_action_hint?: string;
}

export type RunToolOutput =
  | RunHelp
  | RunSuccessInline
  | RunSuccessWrite
  | RunFailure;

export interface ApprovalInterruptPayload {
  kind: "approval";
  server: string;
  tool: string;
  args: Record<string, unknown>;
  message: string;
}

export function describeResult(value: unknown): {
  result_type: RunSuccessInline["result_type"];
  result_count?: number;
} {
  if (value === null || value === undefined) return { result_type: "null" };
  if (Array.isArray(value))
    return { result_type: "array", result_count: value.length };
  const t = typeof value;
  if (t === "object")
    return {
      result_type: "object",
      result_count: Object.keys(value as object).length,
    };
  if (t === "string" || t === "number" || t === "boolean")
    return { result_type: t };
  return { result_type: "null" };
}

export function mapRunError(err: unknown): RunFailure {
  if (RunError.isInstance(err)) {
    if (isHostErrorType(err.code)) {
      return {
        is_error: true,
        error_type: err.code,
        message: err.message,
        next_action_hint: `${hintForHostError(err.code)}\n\n${HOST_API_PRIMER}`,
      };
    }
    if (err.code === "RUN_TIMEOUT") {
      return {
        is_error: true,
        error_type: "sandbox_timeout",
        message: err.message,
        next_action_hint:
          "Shorten the program, avoid tight loops, and capture large MCP dumps instead of pulling them into QuickJS.",
      };
    }
    if (err.code === "RUN_SOURCE_TOO_LARGE") {
      return {
        is_error: true,
        error_type: "invalid_source",
        message: err.message,
        next_action_hint: HOST_API_PRIMER,
      };
    }
    const msg = err.message.toLowerCase();
    if (
      err.code === "RUN_BRIDGE_LIMIT" ||
      err.code === "RUN_CONCURRENCY_LIMIT" ||
      msg.includes("size limit")
    ) {
      return {
        is_error: true,
        error_type: "sandbox_limit",
        message: err.message,
        next_action_hint:
          "Capture once and compute locally. Do not call an MCP tool once per record.",
      };
    }
    if (err.code === "RUN_ABORTED") {
      return {
        is_error: true,
        error_type: "sandbox_timeout",
        message: err.message,
      };
    }
    if (err.code === "RUN_PROTOCOL_ERROR") {
      return {
        is_error: true,
        error_type: "internal_error",
        message: err.message,
        next_action_hint:
          "The stored continuation could not be replayed. Do not invent a new program for a parked approval — the worker should resume the saved run.",
      };
    }
    if (
      msg.includes("expecting") ||
      msg.includes("unexpected") ||
      msg.includes("syntax")
    ) {
      return {
        is_error: true,
        error_type: "invalid_source",
        message: err.message,
        next_action_hint: HOST_API_PRIMER,
      };
    }
    if (msg.includes("memory") || msg.includes("heap")) {
      return {
        is_error: true,
        error_type: "sandbox_memory",
        message: err.message,
        next_action_hint:
          "Reduce the working set: capture to a logical_path and return a small slice.",
      };
    }
    return {
      is_error: true,
      error_type: "host_error",
      message: err.message,
      next_action_hint: HOST_API_PRIMER,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("syntax") || lower.includes("unexpected")) {
    return {
      is_error: true,
      error_type: "invalid_source",
      message,
      next_action_hint: HOST_API_PRIMER,
    };
  }
  if (lower.includes("memory") || lower.includes("out of memory")) {
    return {
      is_error: true,
      error_type: "sandbox_memory",
      message,
      next_action_hint:
        "Reduce the working set: capture to a logical_path and return a small slice.",
    };
  }
  return {
    is_error: true,
    error_type: "internal_error",
    message,
    next_action_hint: HOST_API_PRIMER,
  };
}

export interface SandboxInvocation {
  source: string;
  output_logical_path?: string;
  change_note?: string;
  max_input_bytes?: number;
  continuation?: string;
  resolutions?: RunResolution[];
  continuationContext?: unknown;
  limits?: RunLimits;
}

export type SandboxOutcome =
  | { status: "completed"; output: RunSuccessInline | RunSuccessWrite }
  | {
      status: "interrupted";
      continuation: string;
      continuationContext: unknown;
      interruptions: RunInterruption<ApprovalInterruptPayload>[];
    }
  | { status: "failed"; output: RunFailure };

async function finishCompleted(
  ctx: ToolContext,
  value: unknown,
  input: SandboxInvocation,
): Promise<RunSuccessInline | RunSuccessWrite | RunFailure> {
  if (input.output_logical_path) {
    const body = JSON.stringify(value ?? null, null, 2);
    try {
      const written = await ctx.withMem((mem) =>
        mem.write({
          logical_path: input.output_logical_path as string,
          content: body,
          change_note: input.change_note,
        }),
      );
      return {
        is_error: false,
        logical_path: written.logical_path,
        version_id: written.version_id,
        bytes_written: written.size_bytes,
        preview: body.slice(0, PREVIEW_CHARS),
      };
    } catch (err) {
      return {
        is_error: true,
        error_type: "write_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { is_error: false, result: value, ...describeResult(value) };
}

export async function invokeSandbox(
  ctx: ToolContext,
  input: SandboxInvocation,
): Promise<SandboxOutcome> {
  const continuationContext =
    input.continuationContext ??
    ({
      v: 1,
      projectDir: ctx.projectDir,
      taskId: ctx.taskId ?? null,
    } satisfies Record<string, unknown>);

  try {
    const runner = await createProjectRunner(ctx.projectDir);
    const result: RunResult = await runner.run({
      source: input.source,
      hostFunctions: buildHostFunctions(ctx, {
        maxInputBytes: input.max_input_bytes ?? DEFAULT_MAX_INPUT_BYTES,
      }),
      continuation: input.continuation,
      resolutions: input.resolutions,
      continuationContext,
      limits: input.limits,
    });
    if (result.status === "interrupted") {
      return {
        status: "interrupted",
        continuation: String(result.continuation),
        continuationContext,
        interruptions:
          result.interruptions as RunInterruption<ApprovalInterruptPayload>[],
      };
    }
    const output = await finishCompleted(ctx, result.value, input);
    if (output.is_error) return { status: "failed", output };
    return { status: "completed", output };
  } catch (err) {
    return { status: "failed", output: mapRunError(err) };
  }
}

export async function persistInterruptedRun(
  ctx: ToolContext,
  input: SandboxInvocation,
  interrupted: Extract<SandboxOutcome, { status: "interrupted" }>,
): Promise<{ runId: string; approvalIds: string[] }> {
  const runId = newRunId();
  const approvalIds: string[] = [];
  for (const interruption of interrupted.interruptions) {
    const payload = interruption.payload;
    const created = await createApproval(ctx.projectDir, {
      server: payload.server,
      tool: payload.tool,
      args: payload.args,
      reason: payload.message ?? "membot_run gated MCP call",
      task_id: ctx.taskId ?? null,
      thread_id: ctx.threadId ?? null,
      worker_id: ctx.workerId ?? null,
      run_id: runId,
      interruption_id: interruption.id,
    });
    approvalIds.push(created.id);
  }
  const record: StoredRunContinuation = {
    run_id: runId,
    task_id: ctx.taskId ?? "",
    thread_id: ctx.threadId ?? null,
    worker_id: ctx.workerId ?? null,
    source: input.source,
    output_logical_path: input.output_logical_path,
    change_note: input.change_note,
    max_input_bytes: input.max_input_bytes,
    continuation: interrupted.continuation,
    continuation_context: interrupted.continuationContext,
    approval_ids: approvalIds,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await writeRunContinuation(ctx.projectDir, record);
  return { runId, approvalIds };
}

export async function resumeStoredRun(
  ctx: ToolContext,
  stored: StoredRunContinuation,
): Promise<SandboxOutcome> {
  const approvals = await listApprovals(ctx.projectDir);
  const batch = approvals.filter((a) => stored.approval_ids.includes(a.id));
  if (batch.some((a) => a.status === "pending")) {
    return {
      status: "failed",
      output: {
        is_error: true,
        error_type: "approval_pending",
        message: "This membot_run is still waiting on a human decision.",
      },
    };
  }
  const resolutions: RunResolution[] = [];
  for (const a of batch) {
    if (!a.interruption_id) continue;
    resolutions.push({
      interruptionId: a.interruption_id,
      value: a.status === "approved",
    });
  }
  const outcome = await invokeSandbox(ctx, {
    source: stored.source,
    output_logical_path: stored.output_logical_path,
    change_note: stored.change_note,
    max_input_bytes: stored.max_input_bytes,
    continuation: stored.continuation,
    continuationContext: stored.continuation_context,
    resolutions,
  });
  if (outcome.status === "interrupted") {
    await persistInterruptedRun(
      ctx,
      {
        source: stored.source,
        output_logical_path: stored.output_logical_path,
        change_note: stored.change_note,
        max_input_bytes: stored.max_input_bytes,
      },
      outcome,
    );
    await deleteRunContinuation(ctx.projectDir, stored.run_id);
    return outcome;
  }
  await deleteRunContinuation(ctx.projectDir, stored.run_id);
  return outcome;
}

export function formatResumeNote(outcome: SandboxOutcome): string {
  if (outcome.status === "completed") {
    return `A previously interrupted membot_run for this task completed. Do not generate or execute a new program for that work. Result:\n${JSON.stringify(outcome.output, null, 2)}`;
  }
  if (outcome.status === "failed") {
    return `A previously interrupted membot_run for this task failed: ${outcome.output.message}. Do not invent a replacement program unless the error says to.`;
  }
  return "A previously interrupted membot_run paused again for another approval. Wait for the human decision.";
}
