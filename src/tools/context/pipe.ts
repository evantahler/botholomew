import { z } from "zod";
import { PathConflictError, writeContextFile } from "../../context/store.ts";
import { getTool, type ToolDefinition } from "../tool.ts";

const PREVIEW_CHARS = 200;
const ERROR_MESSAGE_CAP = 2000;
const TOOL_NAME = "pipe_to_context";

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…[truncated, ${s.length - cap} more chars]`;
}

const inputSchema = z.object({
  tool_name: z
    .string()
    .describe(
      "Name of the tool to dispatch. Its full output is piped into a file under context/; you (the LLM) will only see the storage acknowledgment, never the raw bytes.",
    ),
  tool_input: z
    .record(z.string(), z.unknown())
    .describe(
      "Arguments to pass to the inner tool (same shape as a normal call).",
    ),
  path: z
    .string()
    .describe(
      "Project-relative path under context/ to write the captured output to (e.g. 'gdoc/quarterly-plan.md').",
    ),
  on_conflict: z
    .enum(["error", "overwrite"])
    .optional()
    .describe(
      "What to do if a file already exists at this path. Defaults to 'error'. Pass 'overwrite' to replace.",
    ),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  path: z.string().optional(),
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
      "path_conflict",
    ])
    .optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const pipeToContextTool = {
  name: TOOL_NAME,
  description:
    "[[ bash equivalent command: cmd > file ]] Run another tool and pipe its full output directly into a file under context/, without the result flowing through the conversation. Use this when you need a large tool output (Google Docs via mcp_exec, web fetches, search dumps) saved for later inspection but you do NOT need to read the bytes yourself. You'll only see the storage ack (path, size, short preview).",
  group: "context",
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
        message: `Tool "${inner.name}" cannot be piped (terminal tools and pipe_to_context itself are not allowed).`,
        next_action_hint:
          "Pipe a non-terminal tool (search, mcp_exec, etc.) instead.",
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
      const entry = await writeContextFile(
        ctx.projectDir,
        input.path,
        innerOutput,
        { onConflict: input.on_conflict ?? "error" },
      );
      return {
        is_error: false,
        path: entry.path,
        bytes_written: innerOutput.length,
        preview: innerOutput.slice(0, PREVIEW_CHARS),
      };
    } catch (err) {
      if (err instanceof PathConflictError) {
        return {
          is_error: true,
          error_type: "path_conflict",
          path: err.path,
          message: `A file already exists at context/${err.path}. The inner tool ran but its output was discarded.`,
          next_action_hint:
            "Retry with on_conflict='overwrite' to replace, or pick a different path.",
        };
      }
      throw err;
    }
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
