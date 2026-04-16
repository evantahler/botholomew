import ansis from "ansis";
import { loadConfig } from "../config/loader.ts";
import { getDbPath } from "../constants.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { logger } from "../utils/logger.ts";
import { removePidFile, writePidFile } from "../utils/pid.ts";
import type { DaemonStreamCallbacks } from "./llm.ts";
import { tick } from "./tick.ts";

function buildForegroundCallbacks(): DaemonStreamCallbacks {
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

export async function startDaemon(
  projectDir: string,
  options?: { foreground?: boolean },
): Promise<void> {
  const config = await loadConfig(projectDir);
  const dbPath = getDbPath(projectDir);
  const conn = await getConnection(dbPath);
  await migrate(conn);

  // Initialize MCPX client for external tool access
  const mcpxClient = await createMcpxClient(projectDir);
  if (mcpxClient) {
    logger.info("MCPX client initialized with external tools");
  }

  writePidFile(projectDir, process.pid);

  const shutdown = async () => {
    logger.info("Daemon shutting down...");
    await mcpxClient?.close();
    await removePidFile(projectDir);
    conn.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const callbacks = options?.foreground
    ? buildForegroundCallbacks()
    : undefined;

  logger.info(`Daemon started for ${projectDir} (PID ${process.pid})`);
  logger.info(`Tick interval: ${config.tick_interval_seconds}s`);

  while (true) {
    let didWork = false;
    try {
      didWork = await tick(projectDir, conn, config, mcpxClient, callbacks);
    } catch (err) {
      logger.error(`Tick failed: ${err}`);
    }

    if (!didWork) {
      await Bun.sleep(config.tick_interval_seconds * 1000);
    }
  }
}
