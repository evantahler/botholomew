import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteWorker,
  deleteWorkerLog,
  getWorker,
  heartbeat,
  isWorkerRunning,
  listWorkers,
  markWorkerDead,
  markWorkerStopped,
  pruneStoppedWorkers,
  reapDeadWorkers,
  registerWorker,
} from "../../src/workers/store.ts";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "both-workers-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function newWorkerParams(id: string, overrides: Partial<{ pid: number }> = {}) {
  return {
    id,
    pid: overrides.pid ?? 12345,
    hostname: "test-host",
    mode: "persist" as const,
    taskId: null,
    logPath: null,
  };
}

describe("workers store", () => {
  test("registerWorker writes a JSON file with running status", async () => {
    const w = await registerWorker(projectDir, newWorkerParams("w1"));
    expect(w.id).toBe("w1");
    expect(w.status).toBe("running");
    const onDisk = JSON.parse(
      await readFile(join(projectDir, "workers", "w1.json"), "utf-8"),
    );
    expect(onDisk.id).toBe("w1");
    expect(onDisk.status).toBe("running");
    expect(onDisk.pid).toBe(12345);
  });

  test("heartbeat updates last_heartbeat_at", async () => {
    await registerWorker(projectDir, newWorkerParams("hb"));
    const before = await getWorker(projectDir, "hb");
    if (!before) throw new Error("missing");
    await new Promise((r) => setTimeout(r, 10));
    await heartbeat(projectDir, "hb");
    const after = await getWorker(projectDir, "hb");
    if (!after) throw new Error("missing");
    expect(Date.parse(after.last_heartbeat_at)).toBeGreaterThan(
      Date.parse(before.last_heartbeat_at),
    );
  });

  test("heartbeat is a no-op for stopped/dead workers", async () => {
    await registerWorker(projectDir, newWorkerParams("zombie"));
    await markWorkerStopped(projectDir, "zombie");
    const stopped = await getWorker(projectDir, "zombie");
    if (!stopped) throw new Error("missing");
    await new Promise((r) => setTimeout(r, 10));
    await heartbeat(projectDir, "zombie");
    const after = await getWorker(projectDir, "zombie");
    if (!after) throw new Error("missing");
    expect(after.status).toBe("stopped");
    expect(after.last_heartbeat_at).toBe(stopped.last_heartbeat_at);
  });

  test("markWorkerStopped sets stopped_at; markWorkerDead does not overwrite", async () => {
    await registerWorker(projectDir, newWorkerParams("ws"));
    await markWorkerStopped(projectDir, "ws");
    let w = await getWorker(projectDir, "ws");
    if (!w) throw new Error("missing");
    expect(w.status).toBe("stopped");
    expect(w.stopped_at).not.toBeNull();
    // Marking dead after a clean stop is a no-op (forensic value preserved).
    await markWorkerDead(projectDir, "ws");
    w = await getWorker(projectDir, "ws");
    if (!w) throw new Error("missing");
    expect(w.status).toBe("stopped");
  });

  test("reapDeadWorkers flips stale running workers to dead", async () => {
    await registerWorker(projectDir, newWorkerParams("stale"));
    // Backdate heartbeat to ensure it's stale.
    const w = await getWorker(projectDir, "stale");
    if (!w) throw new Error("missing");
    const old = new Date(Date.now() - 60_000).toISOString();
    await Bun.write(
      join(projectDir, "workers", "stale.json"),
      JSON.stringify({ ...w, last_heartbeat_at: old }, null, 2),
    );
    const reaped = await reapDeadWorkers(projectDir, 30);
    expect(reaped).toContain("stale");
    const after = await getWorker(projectDir, "stale");
    expect(after?.status).toBe("dead");
  });

  test("isWorkerRunning reflects current status", async () => {
    await registerWorker(projectDir, newWorkerParams("alive"));
    expect(await isWorkerRunning(projectDir, "alive")).toBe(true);
    await markWorkerDead(projectDir, "alive");
    expect(await isWorkerRunning(projectDir, "alive")).toBe(false);
    expect(await isWorkerRunning(projectDir, "no-such-worker")).toBe(false);
  });

  test("pruneStoppedWorkers deletes old stopped JSON files; keeps dead ones", async () => {
    await registerWorker(projectDir, newWorkerParams("clean"));
    await markWorkerStopped(projectDir, "clean");
    const w = await getWorker(projectDir, "clean");
    if (!w) throw new Error("missing");
    // Backdate stopped_at.
    const old = new Date(Date.now() - 3_600_000).toISOString();
    await Bun.write(
      join(projectDir, "workers", "clean.json"),
      JSON.stringify({ ...w, stopped_at: old }, null, 2),
    );
    await registerWorker(projectDir, newWorkerParams("dead"));
    await markWorkerDead(projectDir, "dead");

    const pruned = await pruneStoppedWorkers(projectDir, 60);
    expect(pruned).toContain("clean");
    expect(await getWorker(projectDir, "clean")).toBeNull();
    // Dead worker survives — kept as forensic evidence.
    expect((await getWorker(projectDir, "dead"))?.status).toBe("dead");
  });

  test("listWorkers filters by status and returns newest-first", async () => {
    await registerWorker(projectDir, newWorkerParams("a"));
    await new Promise((r) => setTimeout(r, 5));
    await registerWorker(projectDir, newWorkerParams("b"));
    await markWorkerStopped(projectDir, "a");
    const running = await listWorkers(projectDir, { status: "running" });
    expect(running.map((w) => w.id)).toEqual(["b"]);
    const all = await listWorkers(projectDir);
    expect(all.map((w) => w.id)).toEqual(["b", "a"]);
  });

  test("deleteWorker removes the JSON file", async () => {
    await registerWorker(projectDir, newWorkerParams("doomed"));
    expect(await deleteWorker(projectDir, "doomed")).toBe(true);
    expect(await getWorker(projectDir, "doomed")).toBeNull();
    expect(await deleteWorker(projectDir, "doomed")).toBe(false);
  });

  test("deleteWorkerLog removes the file under logs/ and is idempotent", async () => {
    const dateDir = join(projectDir, "logs", "2026-05-05");
    await mkdir(dateDir, { recursive: true });
    const logPath = join(dateDir, "w1.log");
    await writeFile(logPath, "hello\n");

    expect(await deleteWorkerLog(projectDir, logPath)).toBe(true);
    expect(await deleteWorkerLog(projectDir, logPath)).toBe(false);
  });

  test("deleteWorkerLog refuses paths outside logs/", async () => {
    const escapePath = join(projectDir, "workers", "evil.log");
    await mkdir(join(projectDir, "workers"), { recursive: true });
    await writeFile(escapePath, "x");
    await expect(deleteWorkerLog(projectDir, escapePath)).rejects.toThrow(
      /refusing to delete log outside/,
    );
    expect(await readFile(escapePath, "utf-8")).toBe("x");
  });
});
