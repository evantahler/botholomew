import ansis from "ansis";
import type { Command } from "commander";
import type { DbConnection } from "../db/connection.ts";
import type { Interaction, Thread } from "../db/threads.ts";
import { deleteThread, getThread, listThreads } from "../db/threads.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

export function registerThreadCommand(program: Command) {
  const thread = program.command("thread").description("Manage chat threads");

  thread
    .command("list")
    .description("List threads")
    .option("-t, --type <type>", "filter by type (daemon_tick, chat_session)")
    .option("-l, --limit <n>", "max number of threads", parseInt)
    .action((opts) =>
      withDb(program, async (conn) => {
        const threads = await listThreads(conn, {
          type: opts.type,
          limit: opts.limit,
        });

        if (threads.length === 0) {
          logger.dim("No threads found.");
          return;
        }

        for (const t of threads) {
          printThread(t);
        }
      }),
    );

  thread
    .command("view <id>")
    .description("View thread details and interactions")
    .option(
      "--only <roles>",
      "show only these roles (comma-separated: user,assistant,tool,system)",
    )
    .action((id, opts) =>
      withDb(program, async (conn) => {
        const resolvedId = await resolveThreadId(conn, id);
        if (!resolvedId) {
          logger.error(`Thread not found: ${id}`);
          process.exit(1);
        }
        const result = await getThread(conn, resolvedId);
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
      }),
    );

  thread
    .command("delete <id>")
    .description("Delete a thread and its interactions")
    .action((id) =>
      withDb(program, async (conn) => {
        const resolvedId = await resolveThreadId(conn, id);
        if (!resolvedId) {
          logger.error(`Thread not found: ${id}`);
          process.exit(1);
        }
        const deleted = await deleteThread(conn, resolvedId);
        if (!deleted) {
          logger.error(`Thread not found: ${id}`);
          process.exit(1);
        }
        logger.success(`Deleted thread: ${resolvedId}`);
      }),
    );
}

async function resolveThreadId(
  conn: DbConnection,
  idPrefix: string,
): Promise<string | null> {
  if (idPrefix.length >= 36) return idPrefix;
  const all = await listThreads(conn);
  const matches = all.filter((t) => t.id.startsWith(idPrefix));
  if (matches.length === 1) {
    const match = matches[0] as Thread;
    return match.id;
  }
  if (matches.length === 0) return null;
  logger.error(
    `Ambiguous thread prefix "${idPrefix}" matches ${matches.length} threads`,
  );
  process.exit(1);
}

function typeColor(type: Thread["type"]): string {
  switch (type) {
    case "daemon_tick":
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
  const id = ansis.dim(t.id.slice(0, 8));
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
