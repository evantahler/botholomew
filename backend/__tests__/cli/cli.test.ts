import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "keryx";
import {
  buildTestUniverse,
  createUserAndLogin,
  HOOK_TIMEOUT,
  TEST_PASSWORD,
  type TestUniverse,
} from "../setup";

/**
 * The product CLI, spawned as a real process against a booted server.
 *
 * The CLI is a session HTTP client — the same surface as the website — so what
 * this suite proves is that a person at a terminal can do what the shell
 * offers: sign in, see their projects, make a tag, invite someone who accepts,
 * and read what happened in the audit log. Each test gets its own config
 * directory, so nothing touches the operator's home and no test inherits
 * another's session.
 */

const CLI = join(import.meta.dir, "..", "..", "..", "cli", "src", "index.ts");

let universe: TestUniverse;
const configDirs: string[] = [];

beforeAll(async () => {
  universe = await buildTestUniverse();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

afterEach(() => {
  for (const dir of configDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A fresh, isolated `XDG_CONFIG_HOME` — one signed-in person per directory.
 * @returns The directory.
 */
function freshConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "botholomew-cli-http-"));
  configDirs.push(dir);
  return dir;
}

/**
 * Spawn the CLI against the booted test server.
 * @param xdg - The config directory this invocation reads and writes.
 * @param args - argv after the binary.
 * @param env - Extra environment; `undefined` removes a key.
 * @returns stdout, stderr, exit code.
 */
async function runCli(
  xdg: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...process.env,
    XDG_CONFIG_HOME: xdg,
    BOTHOLOMEW_URL: universe.url,
    BOTHOLOMEW_PROJECT: undefined,
    NO_COLOR: "1",
    ...env,
  })) {
    if (value !== undefined) merged[key] = value;
  }
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: join(import.meta.dir, "..", "..", "..", "cli"),
    env: merged,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode: await proc.exited };
}

/**
 * Sign a person in to a fresh config directory.
 * @param email - Their email.
 * @returns The config directory now holding their session.
 */
async function loginAs(email: string): Promise<string> {
  const xdg = freshConfigDir();
  const result = await runCli(xdg, [
    "login",
    "--email",
    email,
    "--password",
    TEST_PASSWORD,
    "--json",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return xdg;
}

describe("botholomew login / whoami / project list", () => {
  test("stores a session; subsequent commands use it", async () => {
    const xdg = await loginAs(universe.peach.email);

    const whoami = await runCli(xdg, ["whoami", "--json"]);
    expect(whoami.exitCode).toBe(0);
    expect(whoami.stdout).not.toMatch(/\x1b\[/);
    const me = JSON.parse(whoami.stdout) as { user: { email: string } };
    expect(me.user.email).toBe(universe.peach.email);

    const list = await runCli(xdg, ["project", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    const body = JSON.parse(list.stdout) as { projects: { id: number }[] };
    expect(body.projects.map((p) => p.id).sort()).toEqual(
      [universe.peach.projectId].sort(),
    );
  });

  test("--url beats BOTHOLOMEW_URL, which beats the production default", async () => {
    // The env var names a port nothing listens on, so the flag winning is the
    // only way this signs in.
    const viaFlag = await runCli(
      freshConfigDir(),
      [
        "--url",
        universe.url,
        "login",
        "--email",
        universe.peach.email,
        "--password",
        TEST_PASSWORD,
        "--json",
      ],
      { BOTHOLOMEW_URL: "http://127.0.0.1:9" },
    );
    expect(viaFlag.exitCode, viaFlag.stderr).toBe(0);

    const viaEnv = await runCli(freshConfigDir(), [
      "login",
      "--email",
      universe.peach.email,
      "--password",
      TEST_PASSWORD,
      "--json",
    ]);
    expect(viaEnv.exitCode, viaEnv.stderr).toBe(0);
  });

  test("the password can come from the environment, and a missing one is named", async () => {
    const ok = await runCli(
      freshConfigDir(),
      [
        "login",
        "--email",
        universe.peach.email,
        "--password",
        "$BOTHOLOMEW_TEST_PASSWORD",
        "--json",
      ],
      { BOTHOLOMEW_TEST_PASSWORD: TEST_PASSWORD },
    );
    expect(ok.exitCode, ok.stderr).toBe(0);

    const missing = await runCli(freshConfigDir(), [
      "login",
      "--email",
      universe.peach.email,
      "--password",
      "$BOTHOLOMEW_UNSET_PASSWORD",
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("BOTHOLOMEW_UNSET_PASSWORD");
  });

  test("a command that needs a session says how to get one", async () => {
    const result = await runCli(freshConfigDir(), ["whoami"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("botholomew login");
  });
});

describe("a team, from the terminal", () => {
  test("tag create → invite create → accept → audit list", async () => {
    const peach = await loginAs(universe.peach.email);
    const project = ["--project", String(universe.projectId)];

    const tag = await runCli(peach, [
      ...project,
      "tag",
      "create",
      "--name",
      "plumbers",
      "--json",
    ]);
    expect(tag.exitCode, tag.stderr).toBe(0);
    const { tag: created } = JSON.parse(tag.stdout) as {
      tag: { id: number; name: string };
    };
    expect(created.name).toBe("plumbers");

    // Daisy signs up on her own, then Peach invites her by email, granting the
    // new tag by name.
    const daisy = await createUserAndLogin(
      universe.url,
      "Daisy",
      "daisy@sarasa.land",
      TEST_PASSWORD,
    );
    const invite = await runCli(peach, [
      ...project,
      "invite",
      "create",
      "--email",
      daisy.email,
      "--tag",
      "plumbers",
      "--json",
    ]);
    expect(invite.exitCode, invite.stderr).toBe(0);

    const daisyDir = await loginAs(daisy.email);
    const pending = await runCli(daisyDir, ["invite", "pending", "--json"]);
    expect(pending.exitCode).toBe(0);
    const { invites } = JSON.parse(pending.stdout) as {
      invites: { id: number; projectId: number; tagIds: number[] }[];
    };
    const mine = invites.find((i) => i.projectId === universe.projectId);
    expect(mine?.tagIds).toEqual([created.id]);

    const accept = await runCli(daisyDir, [
      "invite",
      "accept",
      String(mine!.id),
      "--json",
    ]);
    expect(accept.exitCode, accept.stderr).toBe(0);

    // She is a member now, holding the tag she was invited with.
    const members = await runCli(daisyDir, [
      ...project,
      "member",
      "list",
      "--limit",
      "100",
      "--json",
    ]);
    expect(members.exitCode, members.stderr).toBe(0);
    const { memberships } = JSON.parse(members.stdout) as {
      memberships: { userId: number; tags: { name: string }[] }[];
    };
    expect(
      memberships
        .find((m) => m.userId === daisy.userId)
        ?.tags.map((t) => t.name),
    ).toEqual(["plumbers"]);

    // And the audit log, read by the admin, has every step — made by people,
    // so with no bot named on any of them.
    const audit = await runCli(peach, [
      ...project,
      "audit",
      "list",
      "--limit",
      "100",
      "--json",
    ]);
    expect(audit.exitCode, audit.stderr).toBe(0);
    const { auditLogs } = JSON.parse(audit.stdout) as {
      auditLogs: {
        action: string;
        actorBotId: number | null;
        onBehalfOfUserId: number | null;
      }[];
    };
    const actions = auditLogs.map((row) => row.action);
    for (const action of ["tag:create", "invite:create", "invite:accept"]) {
      expect(actions, action).toContain(action);
    }
    expect(
      auditLogs.filter(
        (row) => row.actorBotId !== null || row.onBehalfOfUserId !== null,
      ),
    ).toEqual([]);
  });

  test("a plain member is refused an admin command, with the server's reason", async () => {
    const mario = await loginAs(universe.mario.email);
    const result = await runCli(mario, [
      "--project",
      String(universe.projectId),
      "project",
      "delete",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("admin");
  });

  test("a project slug resolves to its id", async () => {
    const peach = await loginAs(universe.peach.email);
    const view = await runCli(peach, [
      "--project",
      String(universe.projectId),
      "project",
      "view",
      "--json",
    ]);
    const { project } = JSON.parse(view.stdout) as {
      project: { id: number; slug: string };
    };

    const bySlug = await runCli(peach, [
      "--project",
      project.slug,
      "tag",
      "list",
      "--json",
    ]);
    expect(bySlug.exitCode, bySlug.stderr).toBe(0);
    const { tags } = JSON.parse(bySlug.stdout) as { tags: { name: string }[] };
    expect(tags.map((t) => t.name)).toContain("operators");
  });
});
