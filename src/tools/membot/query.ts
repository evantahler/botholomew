import jsonata from "jsonata";
import { isHelpfulError } from "membot";
import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const PREVIEW_CHARS = 200;
/** Default ceiling on the source document size, in characters. */
const DEFAULT_MAX_INPUT_BYTES = 20_000_000;
/** Best-effort wall-clock budget for a single evaluation. */
const EVAL_TIMEOUT_MS = 5_000;

/**
 * Full JSONata syntax reference. Deliberately kept OUT of the tool description
 * (which is loaded every turn) — it is returned only on error or when the agent
 * asks for it via `expression: "?"`, so the standing token cost stays tiny.
 */
const JSONATA_PRIMER = [
  "JSONata syntax reference. Expressions run against the parsed JSON root (`$` = root).",
  "If the file is an array of records, field names map over it; if it's an object, start with a top-level field name.",
  "",
  "Operators:",
  "  field / a.b.c   path navigation (maps over arrays automatically)",
  "  $               the document root",
  "  [ predicate ]   filter, e.g. $[amount > 100] or $[status = 'open']",
  "  .{ k: v }       map: build an object per item (projection)",
  "  { k: agg }      group: bucket the sequence by key k, aggregate each bucket",
  "  ^( >a, <b )     sort: > descending, < ascending; multiple keys allowed",
  "  [[ m..n ]]      slice/index range (0-based, inclusive)",
  "  & ~> | and/or   string concat, function-chain, boolean",
  "",
  "Common functions: $count() $sum() $average() $max() $min() $distinct()",
  "  $substring(str,start,len) $split() $join() $keys() $sort() $reverse()",
  "  $number() $string() $uppercase() $lowercase() $contains() $match()",
  "",
  "Examples (root is an array of records):",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal JSONata group syntax, not a JS template
  "  count by day:    ${ $substring(ts,0,10): $count($) }",
  "  filter:          $[amount > 100]",
  "  pluck fields:    $.{ 'id': id, 'subject': subject }",
  "  dedup a field:   $distinct(email)",
  "  top-10 newest:   $^(>created)[[0..9]]",
  "  sum a field:     $sum(amount)",
  "  count total:     $count($)",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal JSONata group syntax, not a JS template
  "  group + sum:     ${ category: $sum(amount) }",
  "",
  'If the file is an object like { "items": [...] }, prefix with the field: items{ ... }, $sum(items.amount).',
  "",
  "Full language docs (fetch if you have a web tool): https://docs.jsonata.org",
].join("\n");

const inputSchema = z.object({
  logical_path: z
    .string()
    .describe(
      "Logical path of the JSON file to transform (e.g. 'mcp/inbox.json'). Land big tool output here first with membot_pipe, then query it.",
    ),
  expression: z.string().describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal JSONata example, not a JS template
    "JSONata expression evaluated against the parsed JSON root (`$` = root). Examples: count by day `${ $substring(ts,0,10): $count($) }`; filter `$[amount > 100]`; pluck `$.{ 'id': id, 'subject': subject }`; dedup `$distinct(email)`; top-10 newest `$^(>created)[[0..9]]`; sum `$sum(amount)`. Pass \"?\" to get the full syntax reference.",
  ),
  output_logical_path: z
    .string()
    .optional()
    .describe(
      "If set, write the transform result here as a new membot version and return only a storage ack (use for large or chainable output). If omitted, the result is returned inline.",
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
      `Reject the source if its markdown surrogate exceeds this many characters (default ${DEFAULT_MAX_INPUT_BYTES}).`,
    ),
});

const outputSchema = z.object({
  is_error: z.boolean(),
  // inline-result branch
  result: z
    .unknown()
    .optional()
    .describe(
      "The transform result, returned inline when output_logical_path is omitted. Auto-parked by the large-results mechanism if it is still large.",
    ),
  result_type: z
    .enum(["array", "object", "string", "number", "boolean", "null"])
    .optional(),
  result_count: z
    .number()
    .optional()
    .describe("Element count for an array result, or key count for an object."),
  // write branch (parallels membot_pipe)
  logical_path: z.string().optional(),
  version_id: z.string().optional(),
  bytes_written: z.number().optional(),
  preview: z
    .string()
    .optional()
    .describe(`First ${PREVIEW_CHARS} characters of the stored output.`),
  // PAT error envelope
  error_type: z
    .enum([
      "source_not_found",
      "source_too_large",
      "invalid_json",
      "invalid_expression",
      "evaluation_error",
      "write_failed",
      "internal_error",
    ])
    .optional(),
  message: z.string().optional(),
  next_action_hint: z.string().optional(),
});

/** Classify a JSONata result for the token-light output envelope. */
function describeResult(value: unknown): {
  result_type: z.infer<typeof outputSchema>["result_type"];
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

/** Run an evaluation under a soft wall-clock budget. Best-effort: JSONata
 *  yields on async function calls, so a tight synchronous loop may overrun. */
async function evaluateWithTimeout(
  expr: ReturnType<typeof jsonata>,
  data: unknown,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`evaluation exceeded ${EVAL_TIMEOUT_MS}ms`)),
      EVAL_TIMEOUT_MS,
    );
  });
  // Swallow a late rejection from a still-running evaluate after a timeout win,
  // so it never surfaces as an unhandled rejection in the worker/chat process.
  const evaluation = expr.evaluate(data);
  evaluation.catch(() => {});
  try {
    return await Promise.race([evaluation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const membotQueryTool = {
  name: "membot_query",
  description:
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal JSONata example, not a JS template
    "[[ bash equivalent command: jq '<expr>' file ]] Run a JSONata transform over JSON stored at a membot logical_path — reduce/reshape a large blob (group, filter, pluck, dedup, sort, aggregate) WITHOUT loading it into context. Returns the (usually small) result inline, or writes it to output_logical_path for chaining. Pair with membot_pipe: pipe a big MCP result to a logical_path, then query it here. Expressions run against the JSON root (`$`). Examples: count by day `${ $substring(ts,0,10): $count($) }`; filter `$[amount > 100]`; pluck `$.{ 'id': id, 'subject': subject }`; dedup `$distinct(email)`; top-10 newest `$^(>created)[[0..9]]`; sum `$sum(amount)`. Pass expression=\"?\" for the full syntax reference.",
  group: "membot",
  inputSchema,
  outputSchema,
  execute: async (input, ctx): Promise<z.infer<typeof outputSchema>> => {
    // Tier 3: on-demand help — return the primer without touching the source.
    const expression = input.expression.trim();
    if (expression === "" || expression === "?") {
      return { is_error: false, message: JSONATA_PRIMER };
    }

    // 1. Read the source document.
    let content: string;
    try {
      const read = await ctx.withMem((mem) =>
        mem.read({ logical_path: input.logical_path }),
      );
      content = read.content ?? "";
    } catch (err) {
      if (isHelpfulError(err)) {
        return {
          is_error: true,
          error_type: "source_not_found",
          message: err.message,
          next_action_hint: err.hint,
        };
      }
      return {
        is_error: true,
        error_type: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. Size guard.
    const maxBytes = input.max_input_bytes ?? DEFAULT_MAX_INPUT_BYTES;
    if (content.length > maxBytes) {
      return {
        is_error: true,
        error_type: "source_too_large",
        message: `Source is ${content.length} chars, exceeding max_input_bytes (${maxBytes}).`,
        next_action_hint:
          "Narrow the data at the source (more selective MCP args), raise max_input_bytes, or split the document.",
      };
    }

    // 3. Parse JSON.
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return {
        is_error: true,
        error_type: "invalid_json",
        message: `Source at ${input.logical_path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint:
          "membot_query only runs on JSON. Use membot_read for plain text, and confirm the right logical_path.",
      };
    }

    // 4. Compile the expression.
    let expr: ReturnType<typeof jsonata>;
    try {
      expr = jsonata(expression);
    } catch (err) {
      const je = err as { message?: string; position?: number };
      const where =
        typeof je.position === "number" ? ` (at position ${je.position})` : "";
      return {
        is_error: true,
        error_type: "invalid_expression",
        message: `Could not compile JSONata expression${where}: ${je.message ?? String(err)}`,
        next_action_hint: JSONATA_PRIMER,
      };
    }

    // 5. Evaluate (best-effort timeout).
    let out: unknown;
    try {
      out = await evaluateWithTimeout(expr, parsed);
    } catch (err) {
      return {
        is_error: true,
        error_type: "evaluation_error",
        message: `JSONata evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        next_action_hint: `Simplify or pre-filter the expression and retry.\n\n${JSONATA_PRIMER}`,
      };
    }

    // 6a. Write branch.
    if (input.output_logical_path) {
      const body = JSON.stringify(out ?? null, null, 2);
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
        if (isHelpfulError(err)) {
          return {
            is_error: true,
            error_type: "write_failed",
            message: `Transform ran, but write to ${input.output_logical_path} failed: ${err.message}`,
            next_action_hint: err.hint,
          };
        }
        return {
          is_error: true,
          error_type: "internal_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // 6b. Inline branch — let the agent loop auto-park if still large.
    return { is_error: false, result: out, ...describeResult(out) };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
