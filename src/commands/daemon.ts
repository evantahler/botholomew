import type { Command } from "commander";
import { logger } from "../utils/logger.ts";

export function registerDaemonCommand(program: Command) {
  const daemon = program
    .command("daemon")
    .description("Manage the Botholomew daemon");

  daemon
    .command("run")
    .description("Run the daemon in the foreground (blocks until stopped)")
    .action(async () => {
      const dir = program.opts().dir;
      const { startDaemon } = await import("../daemon/index.ts");
      await startDaemon(dir);
    });

  daemon
    .command("start")
    .description("Start the daemon as a background process")
    .action(async () => {
      const dir = program.opts().dir;
      const { spawnDaemon } = await import("../daemon/spawn.ts");
      await spawnDaemon(dir);
    });

  daemon
    .command("stop")
    .description("Stop the daemon for this project")
    .action(async () => {
      const dir = program.opts().dir;
      const { stopDaemon } = await import("../utils/pid.ts");
      const stopped = await stopDaemon(dir);
      if (stopped) {
        logger.success("Daemon stopped.");
      } else {
        logger.warn("No running daemon found.");
      }
    });

  daemon
    .command("status")
    .description("Check if the daemon is running")
    .action(async () => {
      const dir = program.opts().dir;
      const { getDaemonStatus } = await import("../utils/pid.ts");
      const status = await getDaemonStatus(dir);
      if (status) {
        logger.success(`Daemon running (PID ${status.pid})`);
      } else {
        logger.dim("Daemon is not running.");
      }

      const { getWatchdogStatus } = await import("../daemon/watchdog.ts");
      try {
        const watchdog = await getWatchdogStatus(dir);
        if (watchdog.installed) {
          logger.info(`Watchdog: installed (${watchdog.platform})`);
          if (watchdog.configPath) {
            logger.dim(`  Config: ${watchdog.configPath}`);
          }
        } else {
          logger.dim("Watchdog: not installed");
        }
      } catch {
        logger.dim("Watchdog: not installed");
      }
    });

  daemon
    .command("install")
    .description("Install OS-level watchdog (launchd/systemd)")
    .action(async () => {
      const dir = program.opts().dir;
      const { installWatchdog } = await import("../daemon/watchdog.ts");
      try {
        const result = await installWatchdog(dir);
        logger.success(`Watchdog installed (${result.platform})`);
        for (const p of result.paths) {
          logger.dim(`  ${p}`);
        }
      } catch (err) {
        logger.error(
          `Failed to install watchdog: ${err instanceof Error ? err.message : err}`,
        );
      }
    });

  daemon
    .command("uninstall")
    .description("Remove OS-level watchdog")
    .action(async () => {
      const dir = program.opts().dir;
      const { uninstallWatchdog } = await import("../daemon/watchdog.ts");
      try {
        const result = await uninstallWatchdog(dir);
        if (result.removed) {
          logger.success(`Watchdog removed (${result.platform})`);
        } else {
          logger.warn("No watchdog found to remove.");
        }
      } catch (err) {
        logger.error(
          `Failed to remove watchdog: ${err instanceof Error ? err.message : err}`,
        );
      }
    });

  daemon
    .command("list")
    .description("List all registered Botholomew projects on this machine")
    .action(async () => {
      const { listAllWatchdogProjects } = await import("../daemon/watchdog.ts");
      try {
        const projects = await listAllWatchdogProjects();
        if (projects.length === 0) {
          logger.dim("No registered projects found.");
          return;
        }
        for (const p of projects) {
          logger.info(p.projectDir);
          logger.dim(`  Config: ${p.configPath}`);
        }
      } catch (err) {
        logger.error(
          `Failed to list projects: ${err instanceof Error ? err.message : err}`,
        );
      }
    });

  daemon
    .command("healthcheck")
    .description("Run health check (used by watchdog)")
    .action(async () => {
      const dir = program.opts().dir;
      const { runHealthCheck } = await import("../daemon/healthcheck.ts");
      await runHealthCheck(dir);
    });
}
