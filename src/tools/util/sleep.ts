import { z } from "zod";
import type { ToolDefinition } from "../tool.ts";

const MIN_SECONDS = 1;
const MAX_SECONDS = 3600;
const POLL_INTERVAL_MS = 250;

const inputSchema = z.object({
  seconds: z
    .number()
    .int()
    .min(MIN_SECONDS)
    .max(MAX_SECONDS)
    .describe(
      `How long to sleep, in seconds (${MIN_SECONDS}–${MAX_SECONDS}). For longer pauses, create a schedule instead.`,
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "Why you're sleeping — shown to the user under the progress bar. Be specific (e.g. 'waiting for worker to finish task abc').",
    ),
});

const outputSchema = z.object({
  message: z.string(),
  slept_seconds: z.number(),
  aborted: z.boolean(),
  is_error: z.boolean(),
});

export const sleepTool = {
  name: "sleep",
  description:
    "[[ bash equivalent command: sleep ]] Pause the chat agent for a fixed number of seconds. Useful after enqueuing tasks for workers, before checking results. The user sees a progress bar while you wait; pressing Esc cancels the wait. Returns when the time elapses or the user steers.",
  group: "util",
  inputSchema,
  outputSchema,
  execute: async (input, ctx): Promise<z.infer<typeof outputSchema>> => {
    const startedAt = Date.now();
    const totalMs = input.seconds * 1000;
    const shouldAbort = ctx.shouldAbort;

    let aborted: boolean = false;
    await new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let interval: ReturnType<typeof setInterval> | null = null;

      const finish = () => {
        if (timeout) clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve();
      };

      timeout = setTimeout(finish, totalMs);

      if (shouldAbort) {
        interval = setInterval(() => {
          if (shouldAbort()) {
            aborted = true;
            finish();
          }
        }, POLL_INTERVAL_MS);
      }
    });

    const sleptSeconds = (Date.now() - startedAt) / 1000;
    return {
      message: aborted
        ? `Sleep interrupted after ${sleptSeconds.toFixed(1)}s of ${input.seconds}s — user steered.`
        : `Slept ${sleptSeconds.toFixed(1)}s. ${input.reason}`,
      slept_seconds: sleptSeconds,
      aborted,
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
