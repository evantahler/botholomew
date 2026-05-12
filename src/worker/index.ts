import { hostname } from "node:os";
import ansis from "ansis";
import { loadConfig } from "../config/loader.ts";
import { createMcpxClient, resolveMcpxDir } from "../mcpx/client.ts";
import { openMembot, resolveMembotDir } from "../mem/client.ts";
import { logger } from "../utils/logger.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { markWorkerStopped, registerWorker } from "../workers/store.ts";
import { startHeartbeat, startReaper } from "./heartbeat.ts";
import type { WorkerStreamCallbacks } from "./llm.ts";
import { runSpecificTask, tick } from "./tick.ts";

export type WorkerMode = "persist" | "once";

export interface StartWorkerOptions {
  /** When true, stream LLM tokens + tool calls to stdout for the CLI `run` command. */
  foreground?: boolean;
  /** 'once' (default): claim one task and exit. 'persist': run the tick loop forever. */
  mode?: WorkerMode;
  /**
   * When mode='once', optionally pin this worker to a specific task id.
   * When omitted, the worker claims the next eligible task from the queue.
   */
  taskId?: string;
  /**
   * Pre-allocated worker id from the spawn parent. When provided, the parent
   * has already opened a per-worker log file at this id and we record both on
   * the workers row. Foreground/in-process callers may omit this and a fresh
   * id will be generated.
   */
  workerId?: string;
  /**
   * Path to the per-worker log file (set by the spawn parent when launching
   * a detached worker). Stored on the workers row so the TUI can tail it.
   * Null/undefined for foreground workers writing to stdout.
   */
  logPath?: string;
  /**
   * Whether to evaluate schedules as part of this run.
   * Defaults to `true` for one-shot workers without a taskId and for persist
   * workers; `false` when a taskId is supplied (targeted work shouldn't fan
   * out into unrelated schedule processing).
   */
  evalSchedules?: boolean;
}

function buildForegroundCallbacks(): WorkerStreamCallbacks {
  return {
    onTaskStart(task) {
      process.stdout.write(
        `\n${ansis.bold.blue(`Task: ${task.name}`)} ${ansis.dim(`(${task.id})`)}\n`,
      );
      if (task.description) {
        process.stdout.write(`${ansis.dim(task.description)}\n`);
      }
      process.stdout.write("\n");
    },
    onToken(text) {
      process.stdout.write(text);
    },
    onToolStart(name, input) {
      process.stdout.write(
        `  ${ansis.yellow("▶")} ${ansis.bold(name)} ${ansis.dim(input)}\n`,
      );
    },
    onToolEnd(name, _output, isError, durationMs) {
      const seconds = (durationMs / 1000).toFixed(1);
      if (isError) {
        process.stdout.write(
          `  ${ansis.red("✗")} ${ansis.bold(name)} ${ansis.red("error")} ${ansis.dim(`(${seconds}s)`)}\n`,
        );
      } else {
        process.stdout.write(
          `  ${ansis.green("✓")} ${ansis.bold(name)} ${ansis.dim(`(${seconds}s)`)}\n`,
        );
      }
    },
  };
}

export async function startWorker(
  projectDir: string,
  options: StartWorkerOptions = {},
): Promise<void> {
  const mode: WorkerMode = options.mode ?? "once";
  const { taskId } = options;
  const evalSchedules = options.evalSchedules ?? !taskId;

  const config = await loadConfig(projectDir);
  const mem = openMembot(resolveMembotDir(projectDir, config));
  // Surface init-time failures (bad config, locked DB) up front rather than
  // letting the first tool call do it.
  await mem.connect();

  const mcpxClient = await createMcpxClient(resolveMcpxDir(projectDir, config));
  if (mcpxClient) {
    logger.info("MCPX client initialized with external tools");
  }

  const workerId = options.workerId ?? uuidv7();
  await registerWorker(projectDir, {
    id: workerId,
    pid: process.pid,
    hostname: hostname(),
    mode,
    taskId: taskId ?? null,
    logPath: options.logPath ?? null,
  });

  const stopHeartbeat = startHeartbeat(
    projectDir,
    workerId,
    config.worker_heartbeat_interval_seconds,
  );
  const stopReaper =
    mode === "persist"
      ? startReaper(
          projectDir,
          config.worker_reap_interval_seconds,
          config.worker_dead_after_seconds,
          config.worker_stopped_retention_seconds,
        )
      : () => {};

  const shutdown = async () => {
    logger.info("Worker shutting down...");
    stopHeartbeat();
    stopReaper();
    await mcpxClient?.close();
    await mem.close();
    try {
      await markWorkerStopped(projectDir, workerId);
    } catch (err) {
      logger.warn(`failed to mark worker stopped: ${err}`);
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const callbacks = options.foreground ? buildForegroundCallbacks() : undefined;

  logger.info(
    `Worker ${workerId} started ${new Date().toISOString()} for ${projectDir} (PID ${process.pid}, mode=${mode})`,
  );

  try {
    if (mode === "once") {
      if (taskId) {
        await runSpecificTask({
          projectDir,
          mem,
          config,
          workerId,
          taskId,
          mcpxClient,
          callbacks,
        });
      } else {
        await tick({
          projectDir,
          mem,
          config,
          workerId,
          mcpxClient,
          callbacks,
          tickNum: 1,
          evalSchedules,
        });
      }
      return;
    }

    // persist mode: loop forever until SIGTERM/SIGINT flips us into shutdown()
    logger.info(`Tick interval: ${config.tick_interval_seconds}s`);
    let tickNum = 0;
    while (true) {
      tickNum++;
      let didWork = false;
      try {
        didWork = await tick({
          projectDir,
          mem,
          config,
          workerId,
          mcpxClient,
          callbacks,
          tickNum,
          evalSchedules: true,
        });
      } catch (err) {
        logger.error(`Tick failed: ${err}`);
      }

      if (!didWork) {
        logger.phase("sleeping", `${config.tick_interval_seconds}s`);
        await Bun.sleep(config.tick_interval_seconds * 1000);
      }
    }
  } finally {
    stopHeartbeat();
    stopReaper();
    try {
      await markWorkerStopped(projectDir, workerId);
    } catch (err) {
      logger.warn(`failed to mark worker stopped: ${err}`);
    }
    await mcpxClient?.close();
    await mem.close();
  }
}
