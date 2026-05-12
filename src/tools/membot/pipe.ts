import { isHelpfulError } from "membot";
import { z } from "zod";
import { getTool, type ToolDefinition } from "../tool.ts";

const PREVIEW_CHARS = 200;
const ERROR_MESSAGE_CAP = 2000;
const TOOL_NAME = "membot_pipe";

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…[truncated, ${s.length - cap} more chars]`;
}

const inputSchema = z.object({
  tool_name: z
    .string()
    .describe(
      "Name of the tool to dispatch. Its full output is captured and written to membot under `logical_path`; you (the LLM) only see the storage acknowledgment, never the raw bytes.",
    ),
  tool_input: z
    .record(z.string(), z.unknown())
    .describe(
      "Arguments to pass to the inner tool (same shape as a normal call).",
    ),
  logical_path: z
    .string()
    .describe(
      "Destination logical_path under which to store the captured output (e.g. 'gdoc/quarterly-plan.md'). Creates a new version on every call.",
    ),
  change_note: z
    .string()
    .optional()
    .describe("Free-text note attached to the new version."),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  logical_path: z.string().optional(),
  version_id: z.string().optional(),
  bytes_written: z.number().optional(),
  preview: z
    .string()
    .optional()
    .describe(
      `First ${PREVIEW_CHARS} characters of the stored content so you can sanity-check what was captured.`,
    ),
  inner_tool_is_error: z.boolean().optional(),
  error_type: z
    .enum([
      "unknown_tool",
      "forbidden_tool",
      "invalid_input",
      "inner_tool_error",
      "write_failed",
      "internal_error",
    ])
    .optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const membotPipeTool = {
  name: TOOL_NAME,
  description:
    "[[ bash equivalent command: cmd > file ]] Run another tool and pipe its full output directly into a membot logical_path, without the result flowing through the conversation. Use this when you need a large tool output (Google Docs via mcp_exec, web fetches, search dumps) captured for later inspection but you do NOT need to read the bytes yourself. You'll only see the storage ack (logical_path, version_id, short preview).",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const inner = getTool(input.tool_name);
    if (!inner) {
      return {
        is_error: true,
        error_type: "unknown_tool",
        message: `No tool named "${input.tool_name}".`,
        next_action_hint:
          "Check the tool name spelling, or call the inner tool directly if you do need to see its output.",
      };
    }

    if (inner.name === TOOL_NAME || inner.terminal) {
      return {
        is_error: true,
        error_type: "forbidden_tool",
        message: `Tool "${inner.name}" cannot be piped (terminal tools and ${TOOL_NAME} itself are not allowed).`,
        next_action_hint:
          "Pipe a non-terminal tool (mcp_exec, membot_read, etc.) instead.",
      };
    }

    const parsedInner = inner.inputSchema.safeParse(input.tool_input);
    if (!parsedInner.success) {
      const issues = parsedInner.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return {
        is_error: true,
        error_type: "invalid_input",
        message: `Invalid input for ${inner.name}: ${issues}.`,
        next_action_hint:
          "Fix tool_input to match the inner tool's schema and retry.",
      };
    }

    let innerResult: unknown;
    try {
      innerResult = await inner.execute(parsedInner.data, ctx);
    } catch (err) {
      return {
        is_error: true,
        error_type: "inner_tool_error",
        inner_tool_is_error: true,
        message: truncate(
          `Tool ${inner.name} threw: ${err instanceof Error ? err.message : String(err)}`,
          ERROR_MESSAGE_CAP,
        ),
        next_action_hint:
          "Retry with different arguments, or call the tool directly to see the full error.",
      };
    }

    const innerIsError =
      typeof innerResult === "object" &&
      innerResult !== null &&
      "is_error" in innerResult
        ? (innerResult as { is_error: boolean }).is_error
        : false;

    const innerOutput =
      typeof innerResult === "string"
        ? innerResult
        : JSON.stringify(innerResult);

    if (innerIsError) {
      return {
        is_error: true,
        error_type: "inner_tool_error",
        inner_tool_is_error: true,
        message: truncate(innerOutput, ERROR_MESSAGE_CAP),
        next_action_hint:
          "The inner tool returned an error and nothing was written. Fix the inputs and retry, or pipe a different tool.",
      };
    }

    try {
      const written = await ctx.withMem((mem) =>
        mem.write({
          logical_path: input.logical_path,
          content: innerOutput,
          change_note: input.change_note,
        }),
      );
      return {
        is_error: false,
        logical_path: written.logical_path,
        version_id: written.version_id,
        bytes_written: written.size_bytes,
        preview: innerOutput.slice(0, PREVIEW_CHARS),
      };
    } catch (err) {
      if (isHelpfulError(err)) {
        return {
          is_error: true,
          error_type: "write_failed",
          message: `Inner tool ran, but write to ${input.logical_path} failed: ${err.message}`,
          next_action_hint: err.hint,
        };
      }
      return {
        is_error: true,
        error_type: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
