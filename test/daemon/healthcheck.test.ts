import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOTHOLOMEW_DIR, LOG_MAX_BYTES } from "../../src/constants.ts";

let mockPidValue: number | null = null;
let mockAlive = false;
let removePidCalled = false;
let spawnCalled = false;

mock.module("../../src/utils/pid.ts", () => ({
  readPidFile: async () => mockPidValue,
  isProcessAlive: () => mockAlive,
  removePidFile: async () => {
    removePidCalled = true;
  },
}));

mock.module("../../src/daemon/spawn.ts", () => ({
  spawnDaemon: async () => {
    spawnCalled = true;
  },
}));

const { runHealthCheck, rotateLogIfNeeded } = await import(
  "../../src/daemon/healthcheck.ts"
);

let tempDir: string;

beforeEach(async () => {
  mockPidValue = null;
  mockAlive = false;
  removePidCalled = false;
  spawnCalled = false;
  tempDir = await mkdtemp(join(tmpdir(), "bth-hc-"));
  await Bun.write(join(tempDir, BOTHOLOMEW_DIR, "config.json"), "{}");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

describe("runHealthCheck", () => {
  test("does nothing when daemon is alive", async () => {
    mockPidValue = 12345;
    mockAlive = true;

    await runHealthCheck(tempDir);

    expect(removePidCalled).toBe(false);
    expect(spawnCalled).toBe(false);
  });

  test("cleans up stale PID and spawns daemon when process is dead", async () => {
    mockPidValue = 99999;
    mockAlive = false;

    await runHealthCheck(tempDir);

    expect(removePidCalled).toBe(true);
    expect(spawnCalled).toBe(true);
  });

  test("spawns daemon when no PID file exists", async () => {
    mockPidValue = null;

    await runHealthCheck(tempDir);

    expect(removePidCalled).toBe(false);
    expect(spawnCalled).toBe(true);
  });
});

describe("rotateLogIfNeeded", () => {
  test("does nothing when log file does not exist", async () => {
    await rotateLogIfNeeded(tempDir);
    // No error thrown
  });

  test("does nothing when log is under threshold", async () => {
    const logPath = join(tempDir, BOTHOLOMEW_DIR, "daemon.log");
    await Bun.write(logPath, "small log content");

    await rotateLogIfNeeded(tempDir);

    // Original file still exists
    expect(await Bun.file(logPath).exists()).toBe(true);
    // No rotated file
    expect(await Bun.file(`${logPath}.1`).exists()).toBe(false);
  });

  test("rotates log when over threshold", async () => {
    const logPath = join(tempDir, BOTHOLOMEW_DIR, "daemon.log");
    // Write a file larger than LOG_MAX_BYTES
    const largeContent = "x".repeat(LOG_MAX_BYTES + 1024);
    await Bun.write(logPath, largeContent);

    await rotateLogIfNeeded(tempDir);

    // Original should be gone (renamed)
    expect(await Bun.file(logPath).exists()).toBe(false);
    // Rotated file should exist
    expect(await Bun.file(`${logPath}.1`).exists()).toBe(true);
  });
});
