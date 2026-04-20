import ansis from "ansis";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import {
  getWorker,
  listWorkers,
  markWorkerDead,
  markWorkerStopped,
  pruneStoppedWorkers,
  reapDeadWorkers,
  WORKER_STATUSES,
  type Worker,
} from "../db/workers.ts";
import { logger } from "../utils/logger.ts";
import { withDb } from "./with-db.ts";

function formatAge(from: Date, to = new Date()): string {
  const secs = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusColor(status: Worker["status"]): string {
  switch (status) {
    case "running":
      return ansis.green(status);
    case "stopped":
      return ansis.dim(status);
    case "dead":
      return ansis.red(status);
  }
}

function printWorker(w: Worker) {
  const short = w.id.slice(0, 8);
  const lines = [
    `${ansis.bold(short)}  pid=${w.pid}  mode=${w.mode}  ${statusColor(w.status)}  host=${w.hostname}`,
    `  started: ${w.started_at.toISOString()} (${formatAge(w.started_at)})`,
    `  heartbeat: ${w.last_heartbeat_at.toISOString()} (${formatAge(w.last_heartbeat_at)})`,
  ];
  if (w.task_id) lines.push(`  task: ${w.task_id}`);
  if (w.stopped_at) lines.push(`  stopped: ${w.stopped_at.toISOString()}`);
  console.log(lines.join("\n"));
}

export function registerWorkerCommand(program: Command) {
  const worker = program
    .command("worker")
    .description("Manage background workers that claim and run tasks");

  worker
    .command("run")
    .description(
      "Run a worker in the foreground. One-shot by default: claims one task and exits. Use --persist for a long-running tick loop.",
    )
    .option("--persist", "keep running, looping over the tick cycle", false)
    .option(
      "--task-id <id>",
      "run exactly this task (implies one-shot; incompatible with --persist)",
    )
    .option("--no-eval-schedules", "skip schedule evaluation this run")
    .action(
      async (opts: {
        persist?: boolean;
        taskId?: string;
        evalSchedules?: boolean;
      }) => {
        if (opts.persist && opts.taskId) {
          logger.error("--persist and --task-id are mutually exclusive.");
          process.exit(1);
        }
        const dir = program.opts().dir;
        const { startWorker } = await import("../worker/index.ts");
        await startWorker(dir, {
          foreground: true,
          mode: opts.persist ? "persist" : "once",
          taskId: opts.taskId,
          evalSchedules: opts.evalSchedules,
        });
      },
    );

  worker
    .command("start")
    .description("Spawn a worker as a detached background process")
    .option("--persist", "keep running, looping over the tick cycle", false)
    .option("--task-id <id>", "run exactly this task (implies one-shot)")
    .action(async (opts: { persist?: boolean; taskId?: string }) => {
      if (opts.persist && opts.taskId) {
        logger.error("--persist and --task-id are mutually exclusive.");
        process.exit(1);
      }
      const dir = program.opts().dir;
      const { spawnWorker } = await import("../worker/spawn.ts");
      await spawnWorker(dir, {
        mode: opts.persist ? "persist" : "once",
        taskId: opts.taskId,
      });
    });

  worker
    .command("list")
    .description("List workers registered in this project's database")
    .option(
      "-s, --status <status>",
      `filter by status (${WORKER_STATUSES.join("|")})`,
    )
    .option("-l, --limit <n>", "max number of workers", Number.parseInt)
    .option("-o, --offset <n>", "skip first N workers", Number.parseInt)
    .action(
      (opts: { status?: Worker["status"]; limit?: number; offset?: number }) =>
        withDb(program, async (conn) => {
          if (opts.status && !WORKER_STATUSES.includes(opts.status)) {
            logger.error(
              `Unknown status: ${opts.status}. Use one of: ${WORKER_STATUSES.join(", ")}`,
            );
            process.exit(1);
          }
          const workers = await listWorkers(conn, {
            status: opts.status,
            limit: opts.limit,
            offset: opts.offset,
          });
          if (workers.length === 0) {
            logger.dim("No workers found.");
            return;
          }
          for (const w of workers) {
            printWorker(w);
            console.log("");
          }
        }),
    );

  worker
    .command("status <id>")
    .description("Show details for a single worker")
    .action((id: string) =>
      withDb(program, async (conn) => {
        const w = await getWorker(conn, id);
        if (!w) {
          logger.error(`No worker found with id ${id}.`);
          process.exit(1);
        }
        printWorker(w);
      }),
    );

  worker
    .command("stop <id>")
    .description("SIGTERM the worker's process (graceful) and mark stopped")
    .action((id: string) =>
      withDb(program, async (conn) => {
        const w = await getWorker(conn, id);
        if (!w) {
          logger.error(`No worker found with id ${id}.`);
          process.exit(1);
        }
        signalWorker(w, "SIGTERM");
        await markWorkerStopped(conn, id);
        logger.success(`Worker ${id} signaled (SIGTERM) and marked stopped.`);
      }),
    );

  worker
    .command("kill <id>")
    .description("SIGKILL the worker's process and mark dead")
    .action((id: string) =>
      withDb(program, async (conn) => {
        const w = await getWorker(conn, id);
        if (!w) {
          logger.error(`No worker found with id ${id}.`);
          process.exit(1);
        }
        signalWorker(w, "SIGKILL");
        await markWorkerDead(conn, id);
        logger.success(`Worker ${id} killed (SIGKILL) and marked dead.`);
      }),
    );

  worker
    .command("reap")
    .description(
      "Mark stale workers dead (releasing their tasks/schedule claims) and prune cleanly-stopped workers older than the retention window",
    )
    .action(() =>
      withDb(program, async (conn, dir) => {
        const config = await loadConfig(dir);
        const reaped = await reapDeadWorkers(
          conn,
          config.worker_dead_after_seconds,
        );
        if (reaped.length === 0) {
          logger.dim("No stale workers to reap.");
        } else {
          logger.success(
            `Reaped ${reaped.length} worker(s): ${reaped.join(", ")}`,
          );
        }
        const pruned = await pruneStoppedWorkers(
          conn,
          config.worker_stopped_retention_seconds,
        );
        if (pruned.length > 0) {
          logger.success(
            `Pruned ${pruned.length} stopped worker(s) older than retention window.`,
          );
        }
      }),
    );
}

function signalWorker(w: Worker, signal: "SIGTERM" | "SIGKILL"): void {
  if (w.status !== "running") {
    logger.warn(
      `Worker ${w.id} already ${w.status}; signaling PID ${w.pid} anyway.`,
    );
  }
  try {
    process.kill(w.pid, signal);
  } catch (err) {
    logger.warn(
      `Could not send ${signal} to PID ${w.pid}: ${err instanceof Error ? err.message : err}. Marking DB state only.`,
    );
  }
}
