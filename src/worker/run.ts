#!/usr/bin/env bun

// Standalone entry point for a worker when spawned as a detached process.
// Usage: bun run src/worker/run.ts <projectDir> [--worker-id=<uuid>] [--log-path=<path>] [--persist] [--task-id=<uuid>] [--no-eval-schedules]

import { startWorker } from "./index.ts";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error(
    "Usage: bun run src/worker/run.ts <projectDir> [--worker-id=<uuid>] [--log-path=<path>] [--persist] [--task-id=<uuid>] [--no-eval-schedules]",
  );
  process.exit(1);
}

const args = process.argv.slice(3);
const persist = args.includes("--persist");
const noEvalSchedules = args.includes("--no-eval-schedules");
const taskIdArg = args.find((a) => a.startsWith("--task-id="));
const taskId = taskIdArg ? taskIdArg.slice("--task-id=".length) : undefined;
const workerIdArg = args.find((a) => a.startsWith("--worker-id="));
const workerId = workerIdArg
  ? workerIdArg.slice("--worker-id=".length)
  : undefined;
const logPathArg = args.find((a) => a.startsWith("--log-path="));
const logPath = logPathArg ? logPathArg.slice("--log-path=".length) : undefined;

await startWorker(projectDir, {
  mode: persist ? "persist" : "once",
  taskId,
  workerId,
  logPath,
  evalSchedules: noEvalSchedules ? false : undefined,
});
