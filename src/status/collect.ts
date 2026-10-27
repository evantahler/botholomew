import type { BotholomewConfig, Scope } from "../config/schemas.ts";
import { readWithMtime } from "../fs/atomic.ts";
import { resolveMcpxDir } from "../mcpx/client.ts";
import { resolveMembotDir } from "../mem/client.ts";
import type { Schedule } from "../schedules/schema.ts";
import {
  listScheduleFiles,
  parseScheduleFile,
  scheduleFilePath,
} from "../schedules/store.ts";
import { TASK_STATUSES, type TaskStatus } from "../tasks/schema.ts";
import { listTaskFiles, parseTaskFile, taskFilePath } from "../tasks/store.ts";
import { evaluateSchedule } from "../worker/schedules.ts";
import { listWorkers, type Worker } from "../workers/store.ts";

export interface QuarantinedFile {
  id: string;
  reason: string;
}

export interface WorkerSummary {
  total: number;
  running: number;
  stopped: number;
  dead: number;
  /** Most recent heartbeat across all workers, or null if none. */
  latest_heartbeat_at: string | null;
  list: Array<
    Pick<
      Worker,
      "id" | "status" | "mode" | "pid" | "last_heartbeat_at" | "task_id"
    >
  >;
}

export interface TaskSummary {
  /** Count of valid (parseable) tasks. */
  total: number;
  by_status: Record<TaskStatus, number>;
  claimed: Array<{
    id: string;
    name: string;
    claimed_by: string;
    claimed_at: string | null;
  }>;
  quarantined: QuarantinedFile[];
}

export interface ScheduleEntry {
  id: string;
  name: string;
  frequency: string;
  enabled: boolean;
  last_run_at: string | null;
  /** Present only when schedule evaluation ran (enabled schedules, --evaluate). */
  evaluation?: {
    is_due: boolean;
    reasoning: string;
    tasks_to_create: number;
  };
}

export interface ScheduleSummary {
  total: number;
  enabled: number;
  disabled: number;
  list: ScheduleEntry[];
  quarantined: QuarantinedFile[];
}

export interface StoreSummary {
  membot_scope: Scope;
  membot_dir: string;
  mcpx_scope: Scope;
  mcpx_dir: string;
}

export interface StatusReport {
  project_dir: string;
  workers: WorkerSummary;
  tasks: TaskSummary;
  schedules: ScheduleSummary;
  store: StoreSummary;
}

export interface CollectStatusOptions {
  /** Run the LLM schedule evaluator for each enabled schedule. */
  evaluateSchedules: boolean;
}

async function collectWorkers(projectDir: string): Promise<WorkerSummary> {
  const workers = await listWorkers(projectDir);
  let running = 0;
  let stopped = 0;
  let dead = 0;
  let latest: string | null = null;
  for (const w of workers) {
    if (w.status === "running") running++;
    else if (w.status === "stopped") stopped++;
    else dead++;
    if (!latest || w.last_heartbeat_at > latest) latest = w.last_heartbeat_at;
  }
  return {
    total: workers.length,
    running,
    stopped,
    dead,
    latest_heartbeat_at: latest,
    list: workers.map((w) => ({
      id: w.id,
      status: w.status,
      mode: w.mode,
      pid: w.pid,
      last_heartbeat_at: w.last_heartbeat_at,
      task_id: w.task_id,
    })),
  };
}

/**
 * Single-pass task scan. Parses each `tasks/<id>.md` directly via
 * `parseTaskFile` (rather than `getTask`/`listTasks`) so malformed files land
 * in `quarantined` without spraying `logger.warn` over the dashboard output.
 */
async function collectTasks(projectDir: string): Promise<TaskSummary> {
  const by_status = Object.fromEntries(
    TASK_STATUSES.map((s) => [s, 0]),
  ) as Record<TaskStatus, number>;
  const claimed: TaskSummary["claimed"] = [];
  const quarantined: QuarantinedFile[] = [];
  let total = 0;

  for (const id of await listTaskFiles(projectDir)) {
    const file = await readWithMtime(taskFilePath(projectDir, id));
    if (!file) continue;
    const parsed = parseTaskFile(file.content, file.mtimeMs);
    if (!parsed.ok) {
      quarantined.push({ id, reason: parsed.reason });
      continue;
    }
    const t = parsed.task;
    total++;
    by_status[t.status]++;
    if (t.status === "in_progress" && t.claimed_by) {
      claimed.push({
        id: t.id,
        name: t.name,
        claimed_by: t.claimed_by,
        claimed_at: t.claimed_at,
      });
    }
  }

  return { total, by_status, claimed, quarantined };
}

async function collectSchedules(
  projectDir: string,
  config: BotholomewConfig,
  evaluateSchedules: boolean,
): Promise<ScheduleSummary> {
  const quarantined: QuarantinedFile[] = [];
  // Keep each entry paired with its full parsed Schedule so the evaluator
  // receives the real description, last_run_at, etc.
  const parsed: Array<{ entry: ScheduleEntry; schedule: Schedule }> = [];
  let enabled = 0;
  let disabled = 0;

  for (const id of await listScheduleFiles(projectDir)) {
    const file = await readWithMtime(scheduleFilePath(projectDir, id));
    if (!file) continue;
    const result = parseScheduleFile(file.content, file.mtimeMs);
    if (!result.ok) {
      quarantined.push({ id, reason: result.reason });
      continue;
    }
    const s = result.schedule;
    if (s.enabled) enabled++;
    else disabled++;
    parsed.push({
      entry: {
        id: s.id,
        name: s.name,
        frequency: s.frequency,
        enabled: s.enabled,
        last_run_at: s.last_run_at,
      },
      schedule: s,
    });
  }

  // Evaluate enabled schedules in parallel. evaluateSchedule has no disk
  // side-effects and already degrades gracefully on LLM error.
  if (evaluateSchedules) {
    await Promise.all(
      parsed
        .filter((p) => p.schedule.enabled)
        .map(async ({ entry, schedule }) => {
          const evaluation = await evaluateSchedule(config, schedule);
          entry.evaluation = {
            is_due: evaluation.isDue,
            reasoning: evaluation.reasoning,
            tasks_to_create: evaluation.tasksToCreate.length,
          };
        }),
    );
  }

  const list = parsed.map((p) => p.entry);
  return { total: list.length, enabled, disabled, list, quarantined };
}

/**
 * Gather a read-only snapshot of project state for `botholomew status`. Pure
 * data-gathering: no disk mutation (schedule evaluation is read-only). The
 * returned object is fully serializable for `--json`.
 */
export async function collectStatus(
  projectDir: string,
  config: BotholomewConfig,
  opts: CollectStatusOptions,
): Promise<StatusReport> {
  const [workers, tasks, schedules] = await Promise.all([
    collectWorkers(projectDir),
    collectTasks(projectDir),
    collectSchedules(projectDir, config, opts.evaluateSchedules),
  ]);

  return {
    project_dir: projectDir,
    workers,
    tasks,
    schedules,
    store: {
      membot_scope: config.membot_scope,
      membot_dir: resolveMembotDir(projectDir, config),
      mcpx_scope: config.mcpx_scope,
      mcpx_dir: resolveMcpxDir(projectDir, config),
    },
  };
}
