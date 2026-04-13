import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDaemonStatus,
  isProcessAlive,
  readPidFile,
  removePidFile,
  writePidFile,
} from "../../src/utils/pid.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "botholomew-pid-test-"));
  // Create the .botholomew directory
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, ".botholomew"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("writePidFile / readPidFile", () => {
  test("write then read returns correct PID", async () => {
    writePidFile(projectDir, 12345);
    const pid = await readPidFile(projectDir);
    expect(pid).toBe(12345);
  });

  test("readPidFile returns null when file does not exist", async () => {
    const pid = await readPidFile(projectDir);
    expect(pid).toBeNull();
  });

  test("readPidFile returns null for non-numeric content", async () => {
    const pidPath = join(projectDir, ".botholomew", "daemon.pid");
    await Bun.write(pidPath, "not-a-number");
    const pid = await readPidFile(projectDir);
    expect(pid).toBeNull();
  });

  test("readPidFile handles whitespace around PID", async () => {
    const pidPath = join(projectDir, ".botholomew", "daemon.pid");
    await Bun.write(pidPath, "  54321  \n");
    const pid = await readPidFile(projectDir);
    expect(pid).toBe(54321);
  });
});

describe("removePidFile", () => {
  test("removes an existing PID file", async () => {
    writePidFile(projectDir, 99999);
    await removePidFile(projectDir);
    const pid = await readPidFile(projectDir);
    expect(pid).toBeNull();
  });

  test("does not throw when PID file does not exist", async () => {
    // Should not throw
    await removePidFile(projectDir);
  });
});

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent PID", () => {
    // Use a very high PID that almost certainly doesn't exist
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

describe("getDaemonStatus", () => {
  test("returns null when no PID file exists", async () => {
    const status = await getDaemonStatus(projectDir);
    expect(status).toBeNull();
  });

  test("returns pid when daemon process is alive", async () => {
    // Write current process PID (which is alive)
    writePidFile(projectDir, process.pid);
    const status = await getDaemonStatus(projectDir);
    expect(status).not.toBeNull();
    expect(status?.pid).toBe(process.pid);
  });

  test("cleans up PID file and returns null when process is dead", async () => {
    // Write a PID that doesn't exist
    writePidFile(projectDir, 999999999);
    const status = await getDaemonStatus(projectDir);
    expect(status).toBeNull();

    // PID file should have been cleaned up
    const pid = await readPidFile(projectDir);
    expect(pid).toBeNull();
  });
});
