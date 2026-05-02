import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { DbConnection } from "../../../src/db/connection.ts";
import { pipeToContextTool } from "../../../src/tools/context/pipe.ts";
import { contextReadTool } from "../../../src/tools/file/read.ts";
import { registerTool, type ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

// pipe_to_context looks itself up by name when guarding against recursion,
// so it must be in the registry for that test to pass.
registerTool(pipeToContextTool);

let conn: DbConnection;
let ctx: ToolContext;

const D = "agent";

// --- Fixture inner tools (registered once, used across tests) ---

const fixtureOkInput = z.object({
  payload: z.string(),
});
const fixtureOkOutput = z.object({
  echoed: z.string(),
  is_error: z.boolean(),
});
const FIXTURE_OK = "pipe_test_ok_tool";
registerTool({
  name: FIXTURE_OK,
  description: "Echoes payload back",
  group: "test",
  inputSchema: fixtureOkInput,
  outputSchema: fixtureOkOutput,
  execute: async (input) => ({ echoed: input.payload, is_error: false }),
});

const fixtureErrInput = z.object({});
const fixtureErrOutput = z.object({
  message: z.string(),
  is_error: z.boolean(),
});
const FIXTURE_ERR = "pipe_test_err_tool";
registerTool({
  name: FIXTURE_ERR,
  description: "Always returns is_error=true",
  group: "test",
  inputSchema: fixtureErrInput,
  outputSchema: fixtureErrOutput,
  execute: async () => ({ message: "deliberate failure", is_error: true }),
});

// Fixture terminal tool — used to verify pipe rejects terminal tools.
const FIXTURE_TERMINAL = "pipe_test_terminal_tool";
registerTool({
  name: FIXTURE_TERMINAL,
  description: "Terminal fixture",
  group: "test",
  terminal: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ is_error: z.boolean() }),
  execute: async () => ({ is_error: false }),
});

beforeEach(async () => {
  ({ conn, ctx } = await setupToolContext());
});

describe("pipe_to_context", () => {
  test("happy path: dispatches inner tool and stores stringified result", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "hello pipe" },
        drive: D,
        path: "/piped.json",
      },
      ctx,
    );

    expect(result.is_error).toBe(false);
    expect(result.id).toBeTruthy();
    expect(result.drive).toBe(D);
    expect(result.path).toBe("/piped.json");
    expect(result.bytes_written).toBeGreaterThan(0);
    expect(result.preview).toContain("hello pipe");

    const read = await contextReadTool.execute(
      { drive: D, path: "/piped.json" },
      ctx,
    );
    const parsed = JSON.parse(read.content ?? "");
    expect(parsed.echoed).toBe("hello pipe");
    expect(parsed.is_error).toBe(false);
  });

  test("on_conflict='overwrite' replaces existing content", async () => {
    await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "first" },
        drive: D,
        path: "/overwrite.json",
      },
      ctx,
    );

    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "second" },
        drive: D,
        path: "/overwrite.json",
        on_conflict: "overwrite",
      },
      ctx,
    );
    expect(result.is_error).toBe(false);

    const read = await contextReadTool.execute(
      { drive: D, path: "/overwrite.json" },
      ctx,
    );
    expect(read.content).toContain("second");
    expect(read.content).not.toContain("first");
  });

  test("default on_conflict='error' returns path_conflict", async () => {
    await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "original" },
        drive: D,
        path: "/conflict.json",
      },
      ctx,
    );

    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "second" },
        drive: D,
        path: "/conflict.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("path_conflict");
    expect(result.next_action_hint).toContain("on_conflict='overwrite'");

    const read = await contextReadTool.execute(
      { drive: D, path: "/conflict.json" },
      ctx,
    );
    expect(read.content).toContain("original");
  });

  test("inner tool returning is_error=true does NOT write to context", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_ERR,
        tool_input: {},
        drive: D,
        path: "/should-not-exist.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("inner_tool_error");
    expect(result.inner_tool_is_error).toBe(true);
    expect(result.message).toContain("deliberate failure");

    const exists = await conn.queryGet(
      "SELECT 1 FROM context_items WHERE drive = ?1 AND path = ?2",
      D,
      "/should-not-exist.json",
    );
    expect(exists).toBeNull();
  });

  test("unknown inner tool returns unknown_tool error", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "no_such_tool_xyz",
        tool_input: {},
        drive: D,
        path: "/never.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("unknown_tool");
  });

  test("forbidden inner tool: terminal tools are rejected", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_TERMINAL,
        tool_input: {},
        drive: D,
        path: "/never.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("forbidden_tool");
  });

  test("forbidden inner tool: pipe_to_context itself (no recursion)", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: "pipe_to_context",
        tool_input: {
          tool_name: FIXTURE_OK,
          tool_input: { payload: "x" },
          drive: D,
          path: "/inner.json",
        },
        drive: D,
        path: "/outer.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("forbidden_tool");
  });

  test("invalid inner input returns invalid_input with field detail", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: 123 as unknown as string }, // wrong type
        drive: D,
        path: "/bad.json",
      },
      ctx,
    );
    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe("invalid_input");
    expect(result.message).toContain("payload");
  });

  test("ingest runs after a successful pipe (embeddings created)", async () => {
    const result = await pipeToContextTool.execute(
      {
        tool_name: FIXTURE_OK,
        tool_input: { payload: "searchable kubernetes content" },
        drive: D,
        path: "/ingested.txt",
      },
      ctx,
    );
    expect(result.is_error).toBe(false);
    expect(result.id).toBeTruthy();

    const row = await conn.queryGet<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM embeddings WHERE context_item_id = ?1",
      result.id as string,
    );
    expect(row).not.toBeNull();
    expect(Number(row?.cnt ?? 0)).toBeGreaterThan(0);
  });
});
