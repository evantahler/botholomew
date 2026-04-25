import ansis from "ansis";
import type { Command } from "commander";
import { getDbPath } from "../constants.ts";
import { withDb as coreWithDb } from "../db/connection.ts";
import {
  type ProbeResult,
  probeAllTables,
  repairDatabase,
} from "../db/doctor.ts";
import { listWorkers } from "../db/workers.ts";
import { logger } from "../utils/logger.ts";

function statusBadge(status: ProbeResult["status"]): string {
  switch (status) {
    case "ok":
      return ansis.green("ok");
    case "empty":
      return ansis.dim("empty");
    case "missing":
      return ansis.dim("missing");
    case "corrupt":
      return ansis.red.bold("corrupt");
  }
}

function printResults(results: ProbeResult[]) {
  const nameWidth = Math.max(...results.map((r) => r.table.length));
  for (const r of results) {
    const name = r.table.padEnd(nameWidth + 2);
    const detail = r.message ? ansis.dim(`  ${r.message.slice(0, 200)}`) : "";
    console.log(`  ${name}${statusBadge(r.status)}${detail}`);
  }
}

export function registerDbCommand(program: Command) {
  const db = program
    .command("db")
    .description("Inspect and repair the project database");

  db.command("doctor")
    .description(
      "Probe every table for primary-key index corruption and optionally repair via EXPORT/IMPORT",
    )
    .option(
      "-r, --repair",
      "Rebuild the database file from an export when corruption is detected",
    )
    .action((opts) => doctor(program, opts.repair === true));
}

async function doctor(program: Command, repair: boolean): Promise<void> {
  const dir = program.opts().dir as string;
  const dbPath = getDbPath(dir);

  logger.info(`Probing tables in ${dbPath}`);
  const results = await probeAllTables(dbPath);
  printResults(results);

  const corrupt = results.filter((r) => r.status === "corrupt");
  if (corrupt.length === 0) {
    logger.success("No corruption detected.");
    return;
  }

  logger.error(
    `${corrupt.length} table(s) have corrupted indexes: ${corrupt
      .map((r) => r.table)
      .join(", ")}`,
  );

  if (!repair) {
    console.log("");
    console.log(
      ansis.yellow(
        "Re-run with --repair to rebuild the database file (creates a timestamped backup).",
      ),
    );
    process.exit(1);
  }

  // Repair requires exclusive access — refuse if any worker is registered
  // as running, otherwise the EXPORT would race with the worker's writes.
  const running = await coreWithDb(dbPath, async (conn) => {
    try {
      return await listWorkers(conn, { status: "running" });
    } catch {
      // If listWorkers itself trips the corruption we're about to fix,
      // fall through and let repair proceed; the user is on their own
      // for confirming no live workers, which `worker reap` would also
      // be unable to do anyway.
      return [];
    }
  });
  if (running.length > 0) {
    logger.error(
      `${running.length} worker(s) registered as running. Stop them first: botholomew worker stop <id>`,
    );
    for (const w of running) {
      logger.dim(`  ${w.id} (pid ${w.pid}, mode=${w.mode})`);
    }
    process.exit(1);
  }

  logger.phase("repair", "EXPORT DATABASE → swap files → IMPORT DATABASE");
  const result = await repairDatabase(dbPath);
  logger.success(
    `Repaired in ${result.durationMs}ms. Backup: ${result.backupDbPath}`,
  );
  logger.dim(
    "  Re-run `botholomew db doctor` to confirm. Delete the backup once you're sure.",
  );
}
