import ansis from "ansis";
import type { Command } from "commander";
import { getDbPath } from "../constants.ts";
import { withDb as coreWithDb } from "../db/connection.ts";
import {
  isPidAlive,
  type ProbeResult,
  probeAllTables,
  repairDatabase,
} from "../db/doctor.ts";
import { listWorkers, type Worker } from "../db/workers.ts";
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

  // Repair requires exclusive access — refuse if any worker is actually
  // running, otherwise the EXPORT would race with the worker's writes.
  // Stale `status='running'` rows whose PID is dead (the exact case that
  // tends to coexist with workers-table corruption) are reported but do
  // not block repair: trying to flip them to `stopped` would just trip
  // the same corruption we're about to fix.
  const running = await coreWithDb(dbPath, async (conn) => {
    try {
      return await listWorkers(conn, { status: "running" });
    } catch {
      return [] as Worker[];
    }
  });
  const live = running.filter((w) => isPidAlive(w.pid));
  const stale = running.filter((w) => !isPidAlive(w.pid));
  if (live.length > 0) {
    logger.error(
      `${live.length} worker(s) actually running. Stop them first: botholomew worker stop <id>`,
    );
    for (const w of live) {
      logger.dim(`  ${w.id} (pid ${w.pid}, mode=${w.mode})`);
    }
    process.exit(1);
  }
  if (stale.length > 0) {
    logger.warn(
      `${stale.length} worker row(s) marked 'running' but PID is dead — proceeding (rows will be carried through repair, then reapable):`,
    );
    for (const w of stale) {
      logger.dim(`  ${w.id} (pid ${w.pid}, mode=${w.mode})`);
    }
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
