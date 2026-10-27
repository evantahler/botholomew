import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLogTail } from "../../src/worker/log-reader.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "log-reader-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readLogTail", () => {
  test("returns empty + size 0 when the file does not exist", async () => {
    const tail = await readLogTail(join(dir, "missing.log"));
    expect(tail).toEqual({ content: "", truncated: false, size: 0 });
  });

  test("returns the full content for a small file", async () => {
    const path = join(dir, "small.log");
    const body = "line 1\nline 2\nline 3\n";
    await writeFile(path, body);

    const tail = await readLogTail(path);
    expect(tail.content).toBe(body);
    expect(tail.truncated).toBe(false);
    expect(tail.size).toBe(Buffer.byteLength(body));
  });

  test("truncates to the last maxBytes when the file is larger", async () => {
    const path = join(dir, "big.log");
    const body = "x".repeat(2048);
    await writeFile(path, body);

    const tail = await readLogTail(path, 512);
    expect(tail.size).toBe(2048);
    expect(tail.truncated).toBe(true);
    expect(tail.content.length).toBe(512);
    // Tail should be the END of the file
    expect(tail.content).toBe("x".repeat(512));
  });

  test("uses 128KB as the default tail size", async () => {
    const path = join(dir, "default.log");
    const body = "y".repeat(200 * 1024);
    await writeFile(path, body);

    const tail = await readLogTail(path);
    expect(tail.truncated).toBe(true);
    expect(tail.content.length).toBe(128 * 1024);
  });
});
