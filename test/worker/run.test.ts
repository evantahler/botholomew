import { beforeEach, describe, expect, mock, test } from "bun:test";

// `run.ts` calls `startWorker` at module scope of the exported function, so
// stub it out and assert on the options it receives — this file's job is argv
// parsing, not actually running a worker.
const calls: Array<Record<string, unknown>> = [];
mock.module("../../src/worker/index.ts", () => ({
  startWorker: async (projectDir: string, options: Record<string, unknown>) => {
    calls.push({ projectDir, ...options });
  },
}));

const { runWorkerFromArgv } = await import("../../src/worker/run.ts");

beforeEach(() => {
  calls.length = 0;
});

describe("runWorkerFromArgv", () => {
  test("parses --model=<name> into modelName", async () => {
    await runWorkerFromArgv(["/tmp/proj", "--model=fast"]);
    expect(calls[0]?.projectDir).toBe("/tmp/proj");
    expect(calls[0]?.modelName).toBe("fast");
  });

  test("leaves modelName undefined when the flag is absent", async () => {
    await runWorkerFromArgv(["/tmp/proj"]);
    expect(calls[0]?.modelName).toBeUndefined();
  });

  test("parses --model alongside the other flags without cross-talk", async () => {
    await runWorkerFromArgv([
      "/tmp/proj",
      "--persist",
      "--model=local",
      "--unsafe",
      "--worker-id=w1",
    ]);
    expect(calls[0]).toMatchObject({
      mode: "persist",
      modelName: "local",
      unsafe: true,
      workerId: "w1",
    });
  });

  test("accepts a model name containing an '=' (e.g. a tagged local model)", async () => {
    await runWorkerFromArgv(["/tmp/proj", "--model=vendor/model=v2"]);
    expect(calls[0]?.modelName).toBe("vendor/model=v2");
  });
});
