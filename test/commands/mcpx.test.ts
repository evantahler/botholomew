import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runMcpx } from "../../src/commands/mcpx.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-mcpx-cmd-test");
const MCPX_DIR = join(TMP_DIR, ".botholomew", "mcpx");

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
});

describe("mcpx CLI proxy", () => {
  test("servers returns empty array when no config exists", async () => {
    const out = await runMcpx(TMP_DIR, ["servers"]);
    expect(JSON.parse(out)).toEqual([]);
  });

  test("servers returns configured server names", async () => {
    mkdirSync(MCPX_DIR, { recursive: true });
    await Bun.write(
      join(MCPX_DIR, "servers.json"),
      JSON.stringify({
        mcpServers: {
          echo: { command: "echo", args: ["hello"] },
        },
      }),
    );
    const out = await runMcpx(TMP_DIR, ["servers"]);
    const servers = JSON.parse(out);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("echo");
  });

  test("filters out undefined args", async () => {
    const out = await runMcpx(TMP_DIR, ["servers", undefined]);
    expect(JSON.parse(out)).toEqual([]);
  });
});
