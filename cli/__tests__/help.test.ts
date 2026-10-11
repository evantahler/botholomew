import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_BASE_URL } from "../src/config.ts";

const CLI = join(import.meta.dir, "..", "src", "index.ts");

/**
 * Spawn the CLI and capture stdio.
 * @param args - argv after the binary.
 * @param env - Extra environment.
 * @returns stdout, stderr, exit code.
 */
async function spawnCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
  }
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: join(import.meta.dir, ".."),
    env: merged as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("botholomew --help", () => {
  test("prints the ASCII banner", async () => {
    const { stdout, exitCode } = await spawnCli(["--help"], {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BOTHOLOMEW");
    expect(stdout).toContain("{o,o}");
    expect(stdout).toContain("Usage: botholomew");
    expect(stdout).not.toMatch(/\x1b\[/);
  });

  test("colorizes the banner with the accent when color is on", async () => {
    // `COLORTERM` as well as `FORCE_COLOR`: chalk's support sniffing answers a
    // `TERM=linux` console with 16 colors whatever `FORCE_COLOR` asks for, and
    // the accent's hex is only visible at truecolor.
    const { stdout, exitCode } = await spawnCli(["--help"], {
      FORCE_COLOR: "3",
      COLORTERM: "truecolor",
      NO_COLOR: undefined,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("BOTHOLOMEW");
    expect(stdout).toMatch(/\x1b\[/);
    expect(stdout.toLowerCase()).toMatch(/8b7cff|139;124;255/);
  });

  test("--no-color strips ANSI", async () => {
    const { stdout } = await spawnCli(["--help", "--no-color"], {
      FORCE_COLOR: "1",
    });
    expect(stdout).toContain("BOTHOLOMEW");
    expect(stdout).not.toMatch(/\x1b\[/);
  });

  test("--json omits the banner", async () => {
    const { stdout } = await spawnCli(["--help", "--json"], {
      FORCE_COLOR: "1",
    });
    expect(stdout).not.toContain("{o,o}");
  });

  test("names the production default origin", async () => {
    const { stdout } = await spawnCli(["--help"], { NO_COLOR: "1" });
    expect(stdout).toContain(DEFAULT_BASE_URL);
  });

  test("lists exactly the shell's command groups", async () => {
    const { stdout, exitCode } = await spawnCli(["--help"], { NO_COLOR: "1" });
    expect(exitCode).toBe(0);
    const commands = stdout
      .slice(stdout.indexOf("Commands:"))
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((word) => word && /^[a-z]+$/.test(word));
    expect(commands.sort()).toEqual(
      [
        "audit",
        "help",
        "invite",
        "login",
        "logout",
        "member",
        "project",
        "tag",
        "whoami",
      ].sort(),
    );
  });

  test("each group names its subcommands", async () => {
    const expected: Record<string, string[]> = {
      project: ["list", "create", "view", "edit", "delete", "use"],
      tag: ["list", "create", "edit", "delete", "assign", "unassign"],
      member: ["list", "add", "remove"],
      invite: ["list", "pending", "create", "accept", "reject"],
      audit: ["list"],
    };
    for (const [group, subcommands] of Object.entries(expected)) {
      const { stdout, exitCode } = await spawnCli([group, "--help"], {
        NO_COLOR: "1",
      });
      expect(exitCode, group).toBe(0);
      for (const sub of subcommands) {
        expect(stdout, `${group} ${sub}`).toMatch(
          new RegExp(`^\\s+${sub}\\b`, "m"),
        );
      }
    }
  });

  test("login accepts a $VAR reference for the password", async () => {
    const { stdout, exitCode } = await spawnCli(["login", "--help"], {
      NO_COLOR: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--password");
    expect(stdout).toContain("$VAR");
  });

  test("a command the shell does not have is refused", async () => {
    for (const gone of ["run", "agent", "workflow", "connection"]) {
      const result = await spawnCli([gone, "list"], { NO_COLOR: "1" });
      expect(result.exitCode, gone).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`, gone).toContain(
        "unknown command",
      );
    }
  });
});
