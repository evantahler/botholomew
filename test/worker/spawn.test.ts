import { describe, expect, test } from "bun:test";
import { colorlessEnv } from "../../src/worker/spawn.ts";

// A control byte can't appear literally in the test source (biome rejects it
// in regex/string literals), so construct it via char code.
const ESC = String.fromCharCode(0x1b);

describe("colorlessEnv", () => {
  test("forces NO_COLOR and removes color-forcing vars while preserving the rest", () => {
    const env = colorlessEnv({
      FORCE_COLOR: "1",
      COLORTERM: "truecolor",
      CLICOLOR_FORCE: "1",
      FOO: "bar",
    });

    expect(env.NO_COLOR).toBe("1");
    expect(env.FORCE_COLOR).toBeUndefined();
    expect(env.CLICOLOR_FORCE).toBeUndefined();
    // Non-color env is passed through untouched.
    expect(env.FOO).toBe("bar");
    // COLORTERM is harmless once NO_COLOR wins, so we leave it as-is.
    expect(env.COLORTERM).toBe("truecolor");
  });

  test("does not mutate the base env", () => {
    const base: Record<string, string | undefined> = { FORCE_COLOR: "1" };
    colorlessEnv(base);
    expect(base.FORCE_COLOR).toBe("1");
  });

  test("ansis emits no escape codes under this env, even when the parent forces color", async () => {
    // End-to-end: this is the env we hand a detached worker. Run a child that
    // prints ansis-colored text with stdout piped (not a TTY) and confirm the
    // bytes contain no ANSI escape sequences — i.e. ansis resolves to level 0.
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'import ansis from "ansis"; process.stdout.write(ansis.blue("X") + ansis.green("Y") + "\\n");',
      ],
      {
        cwd: import.meta.dir,
        env: colorlessEnv({
          ...process.env,
          FORCE_COLOR: "1",
          COLORTERM: "truecolor",
          TERM: "xterm-256color",
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const out = await new Response(proc.stdout).text();
    await proc.exited;

    expect(out).not.toContain(ESC);
    expect(out.trim()).toBe("XY");
  });
});
