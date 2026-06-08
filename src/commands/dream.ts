import type { LanguageModel } from "ai";
import ansis from "ansis";
import type { Command } from "commander";
import { type ChatTurnCallbacks, runChatTurn } from "../chat/agent.ts";
import { DREAM_PROMPT_BODY } from "../chat/dream-prompt.ts";
import { requireProviderCreds } from "../chat/session.ts";
import { loadConfig } from "../config/loader.ts";
import { createMcpxClient, resolveMcpxDir } from "../mcpx/client.ts";
import type { WithMem } from "../mem/client.ts";
import {
  createThread,
  endThread,
  ensureThreadsDir,
  logInteraction,
} from "../threads/store.ts";
import { logger } from "../utils/logger.ts";
import { utcDateString } from "../utils/v7-date.ts";

/** Gray `HH:MM:SS` stamp, matching the logger's line prefix. */
function ts(): string {
  return ansis.gray(new Date().toTimeString().slice(0, 8));
}

/** Collapse a tool-input blob to a single readable line. */
function previewInput(input: string, max = 100): string {
  const oneLine = input.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export interface DreamOptions {
  /** ISO date or relative duration (`24h`, `7d`). Defaults to `dream_lookback_hours`. */
  since?: string;
  /** Propose edits without writing anything. */
  dryRun?: boolean;
  /** Test seam: inject a language model + membot accessor. */
  _testModel?: LanguageModel;
  _testWithMem?: WithMem;
}

const RELATIVE_RE = /^(\d+)\s*([hd])$/i;

/**
 * Resolve the start of the recall window. Accepts a relative duration
 * (`24h`, `7d`), an ISO date, or — when omitted — `now - lookbackHours`.
 */
export function resolveSince(
  since: string | undefined,
  lookbackHours: number,
  now: Date,
): Date {
  if (!since) {
    return new Date(now.getTime() - lookbackHours * 3600_000);
  }
  const rel = RELATIVE_RE.exec(since.trim());
  if (rel) {
    const n = Number(rel[1]);
    const unitHours = rel[2]?.toLowerCase() === "d" ? 24 : 1;
    return new Date(now.getTime() - n * unitHours * 3600_000);
  }
  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Could not parse --since "${since}". Use an ISO date (2026-06-01) or a relative duration like 24h / 7d.`,
    );
  }
  return parsed;
}

/**
 * Run one reflection ("dream") pass: review recent threads, consolidate
 * durable facts into the knowledge store, and (unless `--dry-run`) apply
 * justified edits to the agent's prompt files. Reuses the chat agent loop and
 * its tool set, so this composes the existing primitives — no new machinery.
 * Returns the audit thread id.
 */
export async function runDream(
  projectDir: string,
  opts: DreamOptions = {},
): Promise<string> {
  const config = await loadConfig(projectDir);
  requireProviderCreds(config);
  await ensureThreadsDir(projectDir);

  const now = new Date();
  const since = resolveSince(opts.since, config.dream_lookback_hours, now);

  const threadId = await createThread(
    projectDir,
    "chat_session",
    undefined,
    `Dream — ${utcDateString(now)}`,
  );

  const windowLine = `Scope your recall to conversations from ${since.toISOString()} onward (it is now ${now.toISOString()}).`;
  const dryRunLine = opts.dryRun
    ? "\n\nIMPORTANT — DRY RUN: Do NOT call `prompt_edit` or any `membot` write tool. Instead, end with a report describing the reflection you would store and the exact prompt edits you would propose, then stop."
    : "";
  const userMessage = `${DREAM_PROMPT_BODY}\n\n${windowLine}${dryRunLine}`;

  await logInteraction(projectDir, threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  logger.info(
    `${ansis.magenta.bold("Dreaming")} — reviewing threads since ${ansis.cyan(
      since.toISOString(),
    )}${opts.dryRun ? ` ${ansis.yellow("(dry run)")}` : ""}`,
  );

  const mcpxClient = await createMcpxClient(resolveMcpxDir(projectDir, config));

  // Chat callbacks don't carry tool durations, so time each call by id.
  const toolStartedAt = new Map<string, number>();
  let midStream = false;

  const callbacks: ChatTurnCallbacks = {
    onToken: (text) => {
      process.stdout.write(text);
      midStream = true;
    },
    onToolStart: (id, name, input) => {
      if (midStream) {
        process.stdout.write("\n");
        midStream = false;
      }
      toolStartedAt.set(id, Date.now());
      process.stdout.write(
        `${ts()} ${ansis.yellow("▶")} ${ansis.bold(name)} ${ansis.dim(
          previewInput(input),
        )}\n`,
      );
    },
    onToolEnd: (id, name, _output, isError) => {
      const startedAt = toolStartedAt.get(id);
      const elapsed = startedAt
        ? ` ${ansis.dim(`(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)}`
        : "";
      toolStartedAt.delete(id);
      const mark = isError ? ansis.red("✗") : ansis.green("✓");
      const status = isError ? ` ${ansis.red("error")}` : "";
      process.stdout.write(
        `${ts()} ${mark} ${ansis.bold(name)}${status}${elapsed}\n`,
      );
    },
  };

  try {
    await runChatTurn({
      messages: [{ role: "user", content: userMessage }],
      projectDir,
      config,
      threadId,
      mcpxClient,
      callbacks,
      _testModel: opts._testModel,
      _testWithMem: opts._testWithMem,
    });
  } finally {
    process.stdout.write("\n");
    await endThread(projectDir, threadId);
    await mcpxClient?.close();
  }

  return threadId;
}

export function registerDreamCommand(program: Command) {
  program
    .command("dream")
    .description(
      "Reflect on recent threads: consolidate durable facts into the knowledge store and update beliefs/goals",
    )
    .option(
      "-s, --since <when>",
      "ISO date or relative duration (24h, 7d) to scope recall (default: dream_lookback_hours)",
    )
    .option(
      "--dry-run",
      "propose edits without writing prompts or the knowledge store",
      false,
    )
    .action(async (opts: { since?: string; dryRun?: boolean }) => {
      const dir = program.opts().dir;
      const threadId = await runDream(dir, {
        since: opts.since,
        dryRun: opts.dryRun,
      });
      logger.success(
        `Dream complete — audit with ${ansis.cyan(`botholomew thread view ${threadId}`)}`,
      );
    });
}
