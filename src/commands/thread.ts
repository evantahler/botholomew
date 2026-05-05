import ansis from "ansis";
import type { Command } from "commander";
import {
  deleteThread,
  getActiveThread,
  getInteractionsAfter,
  getThread,
  type Interaction,
  isThreadEnded,
  listThreads,
  type Thread,
} from "../threads/store.ts";
import { logger } from "../utils/logger.ts";

export function registerThreadCommand(program: Command) {
  const thread = program.command("thread").description("Manage chat threads");

  thread
    .command("list")
    .description("List threads")
    .option("-t, --type <type>", "filter by type (worker_tick, chat_session)")
    .option("-l, --limit <n>", "max number of threads", Number.parseInt)
    .option("-o, --offset <n>", "skip first N threads", Number.parseInt)
    .action(async (opts) => {
      const dir = program.opts().dir;
      const threads = await listThreads(dir, {
        type: opts.type,
        limit: opts.limit,
        offset: opts.offset,
      });

      if (threads.length === 0) {
        logger.dim("No threads found.");
        return;
      }

      for (const t of threads) {
        printThread(t);
      }
    });

  thread
    .command("view <id>")
    .description("View thread details and interactions")
    .option(
      "--only <roles>",
      "show only these roles (comma-separated: user,assistant,tool,system)",
    )
    .action(async (id, opts) => {
      const dir = program.opts().dir;
      const result = await getThread(dir, id);
      if (!result) {
        logger.error(`Thread not found: ${id}`);
        process.exit(1);
      }
      const interactions = opts.only
        ? result.interactions.filter((i) =>
            (opts.only as string).split(",").includes(i.role),
          )
        : result.interactions;
      printThreadDetail(result.thread, interactions);
    });

  thread
    .command("delete <id>")
    .description("Delete a thread and its interactions")
    .action(async (id) => {
      const dir = program.opts().dir;
      const deleted = await deleteThread(dir, id);
      if (!deleted) {
        logger.error(`Thread not found: ${id}`);
        process.exit(1);
      }
      logger.success(`Deleted thread: ${id}`);
    });

  thread
    .command("follow [id]")
    .description("Follow a thread live (like tail -f)")
    .option("-i, --interval <ms>", "poll interval in ms", parseInt)
    .action(async (id, opts) => {
      const dir = program.opts().dir;
      let resolvedId: string;
      if (id) {
        resolvedId = id;
      } else {
        const active = await getActiveThread(dir);
        if (!active) {
          logger.error("No active thread found.");
          process.exit(1);
        }
        resolvedId = active.id;
      }

      const result = await getThread(dir, resolvedId);
      if (!result) {
        logger.error(`Thread not found: ${resolvedId}`);
        process.exit(1);
      }

      printThreadDetail(result.thread, result.interactions);

      if (result.thread.ended_at) {
        logger.dim("Thread already ended.");
        return;
      }

      let lastSequence =
        result.interactions.length > 0
          ? (result.interactions[result.interactions.length - 1]?.sequence ?? 0)
          : 0;

      const pollMs = opts.interval ?? 500;
      logger.info(
        `Following thread ${ansis.dim(resolvedId)}... (Ctrl+C to stop)`,
      );

      const interval = setInterval(async () => {
        try {
          const newInteractions = await getInteractionsAfter(
            dir,
            resolvedId,
            lastSequence,
          );
          for (const i of newInteractions) {
            printInteraction(i);
            lastSequence = i.sequence;
          }

          const ended = await isThreadEnded(dir, resolvedId);
          if (ended) {
            logger.dim("Thread ended.");
            clearInterval(interval);
            process.exit(0);
          }
        } catch {
          // Transient FS errors — retry next tick
        }
      }, pollMs);

      process.on("SIGINT", () => {
        clearInterval(interval);
        console.log();
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
    });
}

function typeColor(type: Thread["type"]): string {
  switch (type) {
    case "worker_tick":
      return ansis.magenta(type);
    case "chat_session":
      return ansis.cyan(type);
  }
}

function statusLabel(thread: Thread): string {
  return thread.ended_at ? ansis.dim("ended") : ansis.green("active");
}

function roleColor(role: Interaction["role"]): string {
  switch (role) {
    case "user":
      return ansis.cyan(role);
    case "assistant":
      return ansis.green(role);
    case "system":
      return ansis.yellow(role);
    case "tool":
      return ansis.magenta(role);
  }
}

function printThread(t: Thread) {
  const id = ansis.dim(t.id);
  const title = t.title || ansis.dim("(untitled)");
  console.log(`  ${id}  ${typeColor(t.type)}  ${statusLabel(t)}  ${title}`);
}

function printThreadDetail(t: Thread, interactions: Interaction[]) {
  console.log(ansis.bold(t.title || "(untitled)"));
  console.log(`  ID:       ${t.id}`);
  console.log(`  Type:     ${typeColor(t.type)}`);
  console.log(`  Status:   ${statusLabel(t)}`);
  if (t.task_id) console.log(`  Task:     ${t.task_id}`);
  console.log(`  Started:  ${t.started_at.toISOString()}`);
  console.log(
    `  Ended:    ${t.ended_at ? t.ended_at.toISOString() : ansis.dim("—")}`,
  );

  if (interactions.length === 0) {
    console.log(`\n  ${ansis.dim("No interactions.")}`);
    return;
  }

  console.log(`\n  Interactions (${interactions.length}):`);
  for (const i of interactions) {
    printInteraction(i);
  }
}

function formatTime(date: Date): string {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

function printInteraction(i: Interaction) {
  const seq = ansis.dim(`#${i.sequence}`);
  const ts = ansis.dim(formatTime(i.created_at));
  const kind = ansis.dim(`[${i.kind}]`);
  let preview: string;
  if (i.kind === "tool_use" && i.tool_name) {
    preview = ansis.yellow(i.tool_name);
  } else {
    const text = i.content.replace(/\n/g, " ");
    preview = text.length > 120 ? `${text.slice(0, 120)}...` : text;
  }
  const extras: string[] = [];
  if (i.token_count) extras.push(`${i.token_count} tok`);
  if (i.duration_ms) extras.push(`${i.duration_ms}ms`);
  const suffix = extras.length > 0 ? `  ${ansis.dim(extras.join(", "))}` : "";
  console.log(
    `  ${seq}  ${ts}  ${roleColor(i.role)}  ${kind}  ${preview}${suffix}`,
  );
}
