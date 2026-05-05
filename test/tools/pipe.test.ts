import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_CONFIG } from "../../src/config/schemas.ts";
import { CONTEXT_DIR } from "../../src/constants.ts";
import { pipeToContextTool } from "../../src/tools/context/pipe.ts";
import { contextWriteTool } from "../../src/tools/file/write.ts";
import type { ToolContext } from "../../src/tools/tool.ts";
import { registerTool } from "../../src/tools/tool.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "both-pipe-"));
  await mkdir(join(tempDir, CONTEXT_DIR), { recursive: true });

  // Stub inner tool: emits a fixed payload + an error variant.
  registerTool({
    name: "_test_emit",
    description: "test",
    group: "test",
    inputSchema: z.object({
      kind: z.enum(["ok", "err"]).default("ok"),
    }),
    outputSchema: z.object({
      payload: z.string().optional(),
      is_error: z.boolean(),
    }),
    execute: async (input) => {
      if (input.kind === "err") return { is_error: true, payload: "boom" };
      return {
        is_error: false,
        payload: "x".repeat(500),
      };
    },
  });

  // Terminal stub for the forbidden-tool test.
  registerTool({
    name: "_test_terminal",
    description: "test terminal",
    group: "test",
    terminal: true,
    inputSchema: z.object({}),
    outputSchema: z.object({ is_error: z.boolean() }),
    execute: async () => ({ is_error: false }),
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    conn: null as never,
    dbPath: ":memory:",
    projectDir: tempDir,
    config: { ...DEFAULT_CONFIG, anthropic_api_key: "test-key" },
    mcpxClient: null,
  };
}

describe("pipe_to_context", () => {
  test("captures inner tool output to a file under context/", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_test_emit",
        tool_input: { kind: "ok" },
        path: "captured/big.json",
      },
      ctx(),
    );
    expect(result.is_error).toBe(false);
    expect(result.path).toBe("captured/big.json");
    expect(result.bytes_written).toBeGreaterThan(0);
    expect(result.preview?.length).toBeLessThanOrEqual(200);

    const onDisk = await Bun.file(
      join(tempDir, CONTEXT_DIR, "captured", "big.json"),
    ).text();
    expect(onDisk.length).toBe(result.bytes_written ?? 0);
  });

  test("returns inner_tool_error when the inner tool fails", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_test_emit",
        tool_input: { kind: "err" },
        path: "captured/should-not-write.json",
      },
      ctx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("inner_tool_error");

    const wrote = await Bun.file(
      join(tempDir, CONTEXT_DIR, "captured", "should-not-write.json"),
    ).exists();
    expect(wrote).toBe(false);
  });

  test("rejects piping a terminal tool", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_test_terminal",
        tool_input: {},
        path: "x.md",
      },
      ctx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("forbidden_tool");
  });

  test("rejects unknown tool", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_does_not_exist",
        tool_input: {},
        path: "x.md",
      },
      ctx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("unknown_tool");
  });

  test("path_conflict when destination exists and on_conflict=error", async () => {
    // Pre-write the destination via the real write tool.
    await contextWriteTool.execute(
      { path: "dst.md", content: "existing" },
      ctx(),
    );
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_test_emit",
        tool_input: { kind: "ok" },
        path: "dst.md",
      },
      ctx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("path_conflict");
  });

  test("on_conflict=overwrite replaces existing file", async () => {
    await contextWriteTool.execute(
      { path: "dst.md", content: "existing" },
      ctx(),
    );
    const result = await pipeToContextTool.execute(
      {
        tool_name: "_test_emit",
        tool_input: { kind: "ok" },
        path: "dst.md",
        on_conflict: "overwrite",
      },
      ctx(),
    );
    expect(result.is_error).toBe(false);
    const onDisk = await Bun.file(join(tempDir, CONTEXT_DIR, "dst.md")).text();
    expect(onDisk.length).toBe(result.bytes_written ?? 0);
  });
});
