import type { Command } from "commander";
import { logger } from "../utils/logger.ts";

export function registerDaemonCommand(program: Command) {
  const daemon = program
    .command("daemon")
    .description("Manage the Botholomew daemon");

  daemon
    .command("start")
    .description("Start the daemon for this project")
    .option("--foreground", "run in the foreground (don't detach)")
    .action(async (opts) => {
      const dir = program.opts().dir;

      if (opts.foreground) {
        // Import dynamically to avoid loading daemon code for other commands
        const { startDaemon } = await import("../daemon/index.ts");
        await startDaemon(dir);
      } else {
        // Spawn detached child process
        const { spawnDaemon } = await import("../daemon/spawn.ts");
        await spawnDaemon(dir);
      }
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
    });

  daemon
    .command("install")
    .description("Install OS-level watchdog (launchd/systemd)")
    .action(async () => {
      logger.warn("Not yet implemented. Coming soon.");
    });
}
