import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_E2E_BACKEND_PORT,
  DEFAULT_E2E_FRONTEND_PORT,
  scopedDatabaseUrl,
  scopedRedisUrl,
  workspacePorts,
  workspaceSlug,
} from "../../scripts/workspace";

// Pure functions behind `bun run workspace:setup` — no server, no database. They
// read the environment at call time precisely so a test can pose as Orca, as
// Conductor, or as neither.
const KEYS = [
  "BOTHOLOMEW_WORKSPACE_ID",
  "CONDUCTOR_WORKSPACE_NAME",
  "CONDUCTOR_PORT",
  "ORCA_WORKTREE_ID",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = Bun.env[key];
    delete Bun.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete Bun.env[key];
    else Bun.env[key] = saved[key];
  }
});

const TEST_DB = "postgres://localhost:5432/botholomew_test";
const TEST_REDIS = "redis://localhost:6379/1";

describe("workspaceSlug", () => {
  test("prefers the explicit override over everything else", () => {
    Bun.env.CONDUCTOR_WORKSPACE_NAME = "conductor-name";
    Bun.env.ORCA_WORKTREE_ID = "uuid::/tmp/orca-name";
    Bun.env.BOTHOLOMEW_WORKSPACE_ID = "chosen by hand";
    expect(workspaceSlug()).toBe("chosen_by_hand");
  });

  // `--id ''` is how a worktree opts out and shares the primary checkout's data,
  // so an empty override has to mean "unscoped" rather than "unset".
  test("treats an empty override as opting out", () => {
    Bun.env.ORCA_WORKTREE_ID = "uuid::/tmp/orca-name";
    Bun.env.BOTHOLOMEW_WORKSPACE_ID = "";
    expect(workspaceSlug()).toBe("");
  });

  test("reads Conductor's workspace name", () => {
    Bun.env.CONDUCTOR_WORKSPACE_NAME = "Fix The Thing";
    expect(workspaceSlug()).toBe("fix_the_thing");
  });

  test("reads the directory out of Orca's <uuid>::<path> worktree id", () => {
    Bun.env.ORCA_WORKTREE_ID =
      "2abeb99c-1c24-4a01-a70c-72f936e078dc::/Users/x/orca/workspaces/botholomew/e2e-port";
    expect(workspaceSlug()).toBe("e2e_port");
  });

  // A uuid is longer than the cap, so what survives is its first 30 characters —
  // still far more than enough to tell two worktrees apart.
  test("falls back to Orca's uuid when the id carries no path", () => {
    Bun.env.ORCA_WORKTREE_ID = "2abeb99c-1c24-4a01-a70c-72f936e078dc";
    expect(workspaceSlug()).toBe("2abeb99c_1c24_4a01_a70c_72f936");
  });

  // The filesystem answer, for a plain terminal that never saw Orca's or
  // Conductor's environment. Nothing above `/` has a `.git`, so it stands in for
  // a directory that is not a checkout at all.
  test("answers empty when there is no checkout to inspect", () => {
    expect(workspaceSlug("/")).toBe("");
  });

  test("caps the slug so the database name stays a legal identifier", () => {
    Bun.env.BOTHOLOMEW_WORKSPACE_ID = "a".repeat(120);
    expect(workspaceSlug().length).toBeLessThanOrEqual(30);
    expect(`botholomew_test_${workspaceSlug()}`.length).toBeLessThan(63);
  });

  test("emits nothing a database name would have to quote", () => {
    Bun.env.BOTHOLOMEW_WORKSPACE_ID = "Feature/DROP TABLE users; --";
    expect(workspaceSlug()).toMatch(/^[a-z0-9_]+$/);
  });
});

describe("scopedDatabaseUrl", () => {
  test("suffixes the database name for a workspace", () => {
    expect(scopedDatabaseUrl(TEST_DB, "e2e_port")).toBe(
      "postgres://localhost:5432/botholomew_test_e2e_port",
    );
  });

  // The whole point of an unscoped checkout answering `""`: everything already
  // written down about `botholomew_test` keeps being true.
  test("leaves an unscoped checkout's database alone", () => {
    expect(scopedDatabaseUrl(TEST_DB, "")).toBe(TEST_DB);
  });

  test("keeps a non-default host, port, and credentials", () => {
    expect(
      scopedDatabaseUrl(
        "postgres://user:pw@db.internal:6000/botholomew_test",
        "w",
      ),
    ).toBe("postgres://user:pw@db.internal:6000/botholomew_test_w");
  });
});

describe("scopedRedisUrl", () => {
  test("moves a workspace off the shared database", () => {
    const index = Number(
      new URL(scopedRedisUrl(TEST_REDIS, "e2e_port")).pathname.replace("/", ""),
    );
    // 0 is development and 1 is an unscoped checkout; neither may be handed out.
    expect(index).toBeGreaterThanOrEqual(2);
    expect(index).toBeLessThanOrEqual(15);
  });

  // Re-running the setup script must not move a workspace's data out from under it.
  test("is stable for one workspace and differs between two", () => {
    const alpha = scopedRedisUrl(TEST_REDIS, "alpha");
    expect(scopedRedisUrl(TEST_REDIS, "alpha")).toBe(alpha);
    expect(scopedRedisUrl(TEST_REDIS, "beta")).not.toBe(alpha);
  });

  test("leaves an unscoped checkout on the database it was given", () => {
    expect(scopedRedisUrl(TEST_REDIS, "")).toBe(TEST_REDIS);
  });
});

describe("workspacePorts", () => {
  test("keeps clear of the dev server, whatever the checkout", () => {
    for (const slug of ["", "alpha", "beta", "some-very-long-workspace-name"]) {
      const { backend, frontend } = workspacePorts(slug);
      expect(backend).not.toBe(8080);
      expect(frontend).not.toBe(3000);
    }
  });

  test("gives two workspaces two different pairs", () => {
    const alpha = workspacePorts("alpha");
    const beta = workspacePorts("beta");
    expect(alpha.backend).not.toBe(beta.backend);
    expect(alpha.frontend).not.toBe(beta.frontend);
  });

  test("an unscoped checkout takes the defaults", () => {
    expect(workspacePorts("")).toEqual({
      backend: DEFAULT_E2E_BACKEND_PORT,
      frontend: DEFAULT_E2E_FRONTEND_PORT,
    });
  });

  // Conductor reserves ten ports per workspace and tells us the first. A reserved
  // range beats a hash, which can collide; 0 and 1 are left for `bun dev`.
  test("uses Conductor's reserved range when it has one", () => {
    Bun.env.CONDUCTOR_PORT = "5300";
    expect(workspacePorts("anything")).toEqual({
      backend: 5302,
      frontend: 5303,
    });
  });
});
