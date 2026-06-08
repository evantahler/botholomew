import ansis from "ansis";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.ts";
import {
  collectStatus,
  type ScheduleEntry,
  type StatusReport,
  type WorkerSummary,
} from "../status/collect.ts";
import type { TaskStatus } from "../tasks/schema.ts";
import type { WorkerStatus } from "../workers/store.ts";

function formatAge(fromIso: string | null, to = new Date()): string {
  if (!fromIso) return "never";
  const from = new Date(fromIso);
  const secs = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function padColored(colored: string, raw: string, width: number): string {
  return colored + " ".repeat(Math.max(0, width - raw.length));
}

function workerStatusColor(status: WorkerStatus): string {
  switch (status) {
    case "running":
      return ansis.green(status);
    case "stopped":
      return ansis.dim(status);
    case "dead":
      return ansis.red(status);
  }
}

function taskStatusColor(status: TaskStatus, label: string): string {
  switch (status) {
    case "pending":
      return ansis.yellow(label);
    case "in_progress":
      return ansis.blue(label);
    case "complete":
      return ansis.green(label);
    case "failed":
      return ansis.red(label);
    case "waiting":
      return ansis.magenta(label);
  }
}

function section(title: string): void {
  console.log(`\n${ansis.bold.underline(title)}`);
}

function renderWorkers(w: WorkerSummary): void {
  section("Workers");
  const parts = [
    `${ansis.green(`${w.running} running`)}`,
    `${ansis.dim(`${w.stopped} stopped`)}`,
    `${w.dead > 0 ? ansis.red(`${w.dead} dead`) : ansis.dim("0 dead")}`,
  ];
  console.log(
    `  ${w.total} total — ${parts.join(", ")}   latest heartbeat: ${formatAge(w.latest_heartbeat_at)}`,
  );
  if (w.list.length === 0) {
    console.log(ansis.dim("  (none)"));
    return;
  }
  for (const wk of w.list) {
    const short = ansis.bold(wk.id.slice(0, 8));
    const status = workerStatusColor(wk.status);
    const task = wk.task_id ? `  task=${wk.task_id.slice(0, 8)}` : "";
    console.log(
      `  ${short}  ${status}  mode=${wk.mode}  pid=${wk.pid}  heartbeat ${formatAge(wk.last_heartbeat_at)}${task}`,
    );
  }
}

function renderTasks(t: StatusReport["tasks"]): void {
  section("Tasks");
  const order: TaskStatus[] = [
    "pending",
    "in_progress",
    "waiting",
    "complete",
    "failed",
  ];
  const counts = order
    .map((s) => taskStatusColor(s, `${t.by_status[s]} ${s}`))
    .join(", ");
  console.log(`  ${t.total} total — ${counts}`);

  if (t.claimed.length > 0) {
    console.log(ansis.bold("\n  Claimed:"));
    for (const c of t.claimed) {
      console.log(
        `  ${ansis.dim(c.id.slice(0, 8))}  ${c.name}  ${ansis.dim(`by ${c.claimed_by.slice(0, 8)} (${formatAge(c.claimed_at)})`)}`,
      );
    }
  }
}

function dueLabel(entry: ScheduleEntry): string {
  if (!entry.evaluation) return ansis.dim("—");
  return entry.evaluation.is_due
    ? ansis.green.bold("due")
    : ansis.dim("not due");
}

function renderSchedules(s: StatusReport["schedules"]): void {
  section("Schedules");
  console.log(
    `  ${s.total} total — ${ansis.green(`${s.enabled} enabled`)}, ${ansis.dim(`${s.disabled} disabled`)}`,
  );
  if (s.list.length === 0) {
    console.log(ansis.dim("  (none)"));
    return;
  }
  for (const e of s.list) {
    const name = e.enabled ? e.name : ansis.dim(e.name);
    const freq = ansis.cyan(e.frequency);
    const last = ansis.dim(`last run ${formatAge(e.last_run_at)}`);
    let line = `  ${name}  (${freq})  ${last}  ${dueLabel(e)}`;
    if (e.evaluation?.is_due && e.evaluation.tasks_to_create > 0) {
      line += ansis.dim(` → ${e.evaluation.tasks_to_create} task(s)`);
    }
    console.log(line);
    if (e.evaluation?.is_due) {
      console.log(ansis.dim(`      ${e.evaluation.reasoning}`));
    }
  }
}

function renderQuarantined(report: StatusReport): void {
  const items = [
    ...report.tasks.quarantined.map((q) => ({ kind: "task", ...q })),
    ...report.schedules.quarantined.map((q) => ({ kind: "schedule", ...q })),
  ];
  if (items.length === 0) return;
  section("Quarantined (invalid frontmatter)");
  for (const q of items) {
    console.log(
      `  ${ansis.red(q.kind)} ${ansis.dim(q.id)} — ${ansis.yellow(q.reason)}`,
    );
  }
}

function renderStore(store: StatusReport["store"]): void {
  section("Store");
  console.log(
    `  membot: ${ansis.cyan(store.membot_scope)}  ${ansis.dim(store.membot_dir)}`,
  );
  console.log(
    `  mcpx:   ${ansis.cyan(store.mcpx_scope)}  ${ansis.dim(store.mcpx_dir)}`,
  );
}

function renderText(report: StatusReport): void {
  console.log(ansis.bold(`Project: ${report.project_dir}`));
  renderWorkers(report.workers);
  renderTasks(report.tasks);
  renderSchedules(report.schedules);
  renderQuarantined(report);
  renderStore(report.store);
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description(
      "One-command project dashboard: workers, tasks, schedules, quarantined files, and store info",
    )
    .option("--json", "output a serialized StatusReport as JSON", false)
    .option(
      "--no-evaluate",
      "skip the LLM evaluation of enabled schedules (faster / offline)",
    )
    .action(async (opts: { json?: boolean; evaluate?: boolean }) => {
      const dir = program.opts().dir;
      const config = await loadConfig(dir);
      const report = await collectStatus(dir, config, {
        evaluateSchedules: opts.evaluate !== false,
      });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      renderText(report);
    });
}
