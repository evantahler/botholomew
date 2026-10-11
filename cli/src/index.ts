#!/usr/bin/env bun
import { createProgram } from "./program.ts";

/**
 * Product CLI entry. Parse argv and run the matching command.
 */
async function main(): Promise<void> {
  await createProgram().parseAsync(process.argv);
}

await main();
