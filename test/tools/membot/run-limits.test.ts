import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import type { MembotClient } from "membot";
import {
  continuationSecretPath,
  loadOrCreateContinuationSecret,
} from "../../../src/tools/membot/run/limits.ts";
import { membotRunTool } from "../../../src/tools/membot/run.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let mem: MembotClient;
let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ mem, ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

describe("membot_run continuation secret", () => {
  test("concurrent creation converges on one secret", async () => {
    const secrets = await Promise.all(
      Array.from({ length: 8 }, () =>
        loadOrCreateContinuationSecret(ctx.projectDir),
      ),
    );
    const encoded = secrets.map((s) => Buffer.from(s).toString("hex"));
    expect(new Set(encoded).size).toBe(1);
    expect(secrets[0]?.byteLength).toBeGreaterThanOrEqual(32);
  });

  test("is written owner-only", async () => {
    await loadOrCreateContinuationSecret(ctx.projectDir);
    const info = await stat(continuationSecretPath(ctx.projectDir));
    expect(info.mode & 0o077).toBe(0);
  });

  test("a second call reuses the stored secret", async () => {
    const first = await loadOrCreateContinuationSecret(ctx.projectDir);
    const second = await loadOrCreateContinuationSecret(ctx.projectDir);
    expect(Buffer.from(second).toString("hex")).toBe(
      Buffer.from(first).toString("hex"),
    );
  });
});

describe("membot_run input ceiling", () => {
  test("max_input_bytes counts bytes, not characters", async () => {
    // 30 three-byte characters: 30 chars, 90 bytes.
    const content = JSON.stringify({ s: "€".repeat(30) });
    await mem.write({ logical_path: "wide.json", content });

    const tooSmall = await membotRunTool.execute(
      {
        source: `return await files.readJson("wide.json");`,
        max_input_bytes: Buffer.byteLength(content, "utf8") - 1,
      },
      ctx,
    );
    expect(tooSmall).toMatchObject({
      is_error: true,
      error_type: "source_too_large",
    });
    expect(tooSmall.is_error && tooSmall.message).toContain("bytes");

    const fits = await membotRunTool.execute(
      {
        source: `return (await files.readJson("wide.json")).s.length;`,
        max_input_bytes: Buffer.byteLength(content, "utf8"),
      },
      ctx,
    );
    expect(fits).toMatchObject({ is_error: false, result: 30 });
  });
});
