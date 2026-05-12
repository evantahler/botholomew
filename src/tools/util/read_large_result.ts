import { z } from "zod";
import {
  PAGE_SIZE_CHARS,
  peekLargeResult,
  readLargeResultPage,
} from "../../worker/large-results.ts";
import type { ToolDefinition } from "../tool.ts";

const ID_PATTERN = /^lr_\d+$/;

const inputSchema = z.object({
  id: z
    .string()
    .regex(ID_PATTERN)
    .describe(
      'Large-result id from the "Paginated for LLM" stub, e.g. "lr_1".',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe(
      `1-based page number. Each page is ~${PAGE_SIZE_CHARS} chars. Start at 1; the response includes total_pages so you know when to stop.`,
    ),
});

const outputSchema = z.object({
  content: z.string(),
  id: z.string(),
  page: z.number(),
  total_pages: z.number(),
  total_chars: z.number(),
  is_error: z.boolean(),
  error_type: z.string().optional(),
  next_action_hint: z.string().optional(),
});

export const readLargeResultTool = {
  name: "read_large_result",
  description: `[[ bash equivalent command: sed -n '<page>p' ]] Read one page of a large tool result that was cached because its inline payload exceeded the response budget. Use the id from the "Paginated for LLM" stub. Pages are 1-based and ~${PAGE_SIZE_CHARS} chars each; loop from page=1 to total_pages.`,
  group: "util",
  inputSchema,
  outputSchema,
  execute: async (input, _ctx): Promise<z.infer<typeof outputSchema>> => {
    const meta = peekLargeResult(input.id);
    if (!meta) {
      return {
        content: "",
        id: input.id,
        page: input.page,
        total_pages: 0,
        total_chars: 0,
        is_error: true,
        error_type: "unknown_id",
        next_action_hint:
          "Large-result entries live only for the current worker tick or chat session and are cleared between worker tasks. Re-run the originating tool to regenerate the result.",
      };
    }

    const result = readLargeResultPage(input.id, input.page);
    if (!result) {
      return {
        content: "",
        id: input.id,
        page: input.page,
        total_pages: meta.totalPages,
        total_chars: meta.totalChars,
        is_error: true,
        error_type: "page_out_of_range",
        next_action_hint: `page=${input.page} is past the end. Valid pages are 1–${meta.totalPages}.`,
      };
    }

    return {
      content: result.content,
      id: input.id,
      page: result.page,
      total_pages: result.totalPages,
      total_chars: meta.totalChars,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
