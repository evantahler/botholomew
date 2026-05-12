import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runMcpx } from "../../src/commands/mcpx.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-mcpx-cmd-test");
const MCPX_DIR = join(TMP_DIR, "mcpx");
const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

// Force project-local mcpx for these tests — the default is "global", which
// would point runMcpx at ~/.mcpx and pollute / leak real user state.
beforeEach(async () => {
  mkdirSync(join(TMP_DIR, "config"), { recursive: true });
  await Bun.write(
    join(TMP_DIR, "config", "config.json"),
    JSON.stringify({ mcpx_scope: "project", membot_scope: "project" }),
  );
});

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
});

async function runBotholomewCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", CLI_PATH, "-d", TMP_DIR, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

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

describe("mcpx CLI passthrough (end-to-end)", () => {
  // Regression test: previously the wrapper declared --args as variadic and
  // forwarded each value with a repeated --args flag, but upstream mcpx
  // treats --args as a single comma-separated value, so last-one-wins would
  // silently drop all but the final arg.
  test("add preserves every value in a comma-separated --args", async () => {
    const result = await runBotholomewCli([
      "mcpx",
      "add",
      "echo",
      "--command",
      "echo",
      "--args",
      "hello,world",
      "--no-auth",
      "--no-index",
    ]);
    expect(result.exitCode).toBe(0);

    const servers = await Bun.file(join(MCPX_DIR, "servers.json")).json();
    expect(servers.mcpServers.echo).toEqual({
      command: "echo",
      args: ["hello", "world"],
    });
  });

  test("add rejects when neither --command nor --url is given", async () => {
    const result = await runBotholomewCli(["mcpx", "add", "foo"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("mcpx exec --help forwards to upstream help renderer", async () => {
    const result = await runBotholomewCli(["mcpx", "exec", "--help"]);
    expect(result.exitCode).toBe(0);
    // Upstream help text includes option descriptions that the old wrapper
    // did not surface, e.g. --ttl and --no-wait.
    expect(result.stdout).toContain("--ttl");
    expect(result.stdout).toContain("--no-wait");
  });

  test("remove --dry-run leaves servers.json untouched", async () => {
    mkdirSync(MCPX_DIR, { recursive: true });
    const initial = {
      mcpServers: {
        echo: { command: "echo", args: ["hi"] },
      },
    };
    await Bun.write(
      join(MCPX_DIR, "servers.json"),
      JSON.stringify(initial, null, 2),
    );

    const out = await runMcpx(TMP_DIR, ["remove", "echo", "--dry-run"]);
    expect(out).toContain("Would remove");

    const after = await Bun.file(join(MCPX_DIR, "servers.json")).json();
    expect(after).toEqual(initial);
  });

  test("remove --keep-auth preserves auth.json entry", async () => {
    mkdirSync(MCPX_DIR, { recursive: true });
    await Bun.write(
      join(MCPX_DIR, "servers.json"),
      JSON.stringify({
        mcpServers: { arcade: { url: "https://example.test/mcp" } },
      }),
    );
    await Bun.write(
      join(MCPX_DIR, "auth.json"),
      JSON.stringify({ arcade: { access_token: "abc" } }),
    );

    await runMcpx(TMP_DIR, ["remove", "arcade", "--keep-auth"]);

    const auth = await Bun.file(join(MCPX_DIR, "auth.json")).json();
    expect(auth.arcade).toEqual({ access_token: "abc" });

    const servers = await Bun.file(join(MCPX_DIR, "servers.json")).json();
    expect(servers.mcpServers.arcade).toBeUndefined();
  });

  test("deauth removes the entry from auth.json", async () => {
    mkdirSync(MCPX_DIR, { recursive: true });
    await Bun.write(
      join(MCPX_DIR, "auth.json"),
      JSON.stringify({ arcade: { access_token: "abc" } }),
    );

    const out = await runMcpx(TMP_DIR, ["deauth", "arcade"]);
    expect(out).toContain("Deauthenticated");

    const auth = await Bun.file(join(MCPX_DIR, "auth.json")).json();
    expect(auth.arcade).toBeUndefined();
  });

  test("list exits 0 with an empty config", async () => {
    const result = await runBotholomewCli(["mcpx", "list"]);
    expect(result.exitCode).toBe(0);
  });
});
