#!/usr/bin/env bun

// Worker entry when spawned as a detached process.
//   - Dev / `bun install -g`: `bun run src/worker/run.ts <projectDir> [flags]`
//   - Compiled binary: the parent re-execs the binary with WORKER_RUN_SENTINEL
//     as argv[2] (see ../cli.ts and ./spawn.ts), then calls runWorkerFromArgv.
// Flags: [--worker-id=<uuid>] [--log-path=<path>] [--persist] [--task-id=<uuid>]
//        [--no-eval-schedules] [--unsafe] [--model=<name>]

import { startWorker } from "./index.ts";

const USAGE =
  "Usage: bun run src/worker/run.ts <projectDir> [--worker-id=<uuid>] [--log-path=<path>] [--persist] [--task-id=<uuid>] [--no-eval-schedules] [--unsafe] [--model=<name>]";

/**
 * Parse worker args (`<projectDir> [flags]`) and start the worker. Shared by
 * the standalone `run.ts` invocation (dev) and the binary's sentinel branch.
 */
export async function runWorkerFromArgv(args: string[]): Promise<void> {
  const projectDir = args[0];
  if (!projectDir) {
    console.error(USAGE);
    process.exit(1);
  }

  const flags = args.slice(1);
  const persist = flags.includes("--persist");
  const noEvalSchedules = flags.includes("--no-eval-schedules");
  const unsafe = flags.includes("--unsafe");
  const taskIdArg = flags.find((a) => a.startsWith("--task-id="));
  const taskId = taskIdArg ? taskIdArg.slice("--task-id=".length) : undefined;
  const workerIdArg = flags.find((a) => a.startsWith("--worker-id="));
  const workerId = workerIdArg
    ? workerIdArg.slice("--worker-id=".length)
    : undefined;
  const modelArg = flags.find((a) => a.startsWith("--model="));
  const modelName = modelArg ? modelArg.slice("--model=".length) : undefined;
  const logPathArg = flags.find((a) => a.startsWith("--log-path="));
  const logPath = logPathArg
    ? logPathArg.slice("--log-path=".length)
    : undefined;

  await startWorker(projectDir, {
    mode: persist ? "persist" : "once",
    taskId,
    workerId,
    logPath,
    evalSchedules: noEvalSchedules ? false : undefined,
    unsafe,
    modelName,
  });
}

// Only run when invoked directly (`bun run …/run.ts`), not when imported by
// cli.ts (the compiled binary's entrypoint), which would otherwise execute a
// worker on every CLI invocation.
if (import.meta.main) {
  await runWorkerFromArgv(process.argv.slice(2));
}
