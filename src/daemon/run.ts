#!/usr/bin/env bun

// Standalone entry point for the daemon when spawned as a detached process.
// Usage: bun run src/daemon/run.ts <projectDir>

import { startDaemon } from "./index.ts";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("Usage: bun run src/daemon/run.ts <projectDir>");
  process.exit(1);
}

await startDaemon(projectDir);
