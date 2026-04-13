import { loadConfig } from "../config/loader.ts";
import { getDbPath } from "../constants.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { logger } from "../utils/logger.ts";
import { removePidFile, writePidFile } from "../utils/pid.ts";
import { tick } from "./tick.ts";

export async function startDaemon(projectDir: string): Promise<void> {
  const config = await loadConfig(projectDir);
  const dbPath = getDbPath(projectDir);
  const conn = await getConnection(dbPath);
  await migrate(conn);

  writePidFile(projectDir, process.pid);

  const shutdown = async () => {
    logger.info("Daemon shutting down...");
    await removePidFile(projectDir);
    conn.closeSync();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.info(`Daemon started for ${projectDir} (PID ${process.pid})`);
  logger.info(`Tick interval: ${config.tick_interval_seconds}s`);

  while (true) {
    try {
      await tick(projectDir, conn, config);
    } catch (err) {
      logger.error(`Tick failed: ${err}`);
    }

    await Bun.sleep(config.tick_interval_seconds * 1000);
  }
}
