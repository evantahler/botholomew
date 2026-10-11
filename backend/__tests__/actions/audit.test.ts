import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, desc, eq, like } from "drizzle-orm";
import {
  type ActionResponse,
  api,
  CONNECTION_TYPE,
  Connection,
  config,
  HTTP_METHOD,
} from "keryx";
import { z } from "zod";
import type { AuditList } from "../../actions/audit/audit-list";
import type { TagCreate } from "../../actions/tag/tag-create";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { serializeProject } from "../../ops/ProjectOps";
import { type AuditLog, auditLogs } from "../../schema/audit_logs";
import { projects } from "../../schema/projects";
import {
  authHeaders,
  buildTestUniverse,
  cookieHeader,
  HOOK_TIMEOUT,
  runAction,
  type TestUniverse,
} from "../setup";

let universe: TestUniverse;
let url: string;

beforeAll(async () => {
  universe = await buildTestUniverse();
  url = universe.url;
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

/**
 * Read every audit row for an action name, newest first.
 * @param action - The action name to filter on.
 * @returns The matching audit rows.
 */
async function rowsFor(action: string): Promise<AuditLog[]> {
  return api.db.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, action))
    .orderBy(desc(auditLogs.id));
}

/**
 * A `Date` the given number of days in the past.
 * @param days - How many days back.
 * @returns The computed timestamp.
 */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** A fresh, session-less connection for driving an action's `run()` directly. */
function bareConnection(): AuditedConnection {
  return new Connection(CONNECTION_TYPE.CLI, "audit-test");
}

// ---------------------------------------------------------------------------
// Throwaway subclasses. These are defined here rather than under `actions/` on
// purpose: they are never registered with the framework, so they can misbehave
// (throw mid-write, throw from `afterCommit`) without any of it being reachable
// over HTTP. Each is driven by calling `run()` directly.
// ---------------------------------------------------------------------------

/** Writes a project row and then throws — the rollback property under test. */
class RollbackProbe extends AuditedAction {
  name = "test:rollback-probe";
  description = "Test-only action that writes a row and then fails.";
  middleware = [];
  web = { route: "/test/rollback-probe", method: HTTP_METHOD.PUT };
  inputs = z.object({ name: z.string() });

  /**
   * @param tx - The audited transaction.
   * @param params - `{ name }` for the project to insert.
   * @param connection - The caller's connection.
   * @returns Never — always throws after writing.
   */
  async runWithAudit(
    tx: TxHandle,
    params: { name: string },
    connection: AuditedConnection,
  ) {
    const [project] = await tx
      .insert(projects)
      .values({ name: params.name, slug: params.name })
      .returning();
    connection.metadata.auditAfter = serializeProject(project);
    throw new Error("the mutation failed after writing");
  }
}

/** Sets `auditBefore` only when asked, so a leak across runs is observable. */
class IsolationProbe extends AuditedAction {
  name = "test:isolation-probe";
  description =
    "Test-only action that conditionally records a before snapshot.";
  middleware = [];
  web = { route: "/test/isolation-probe", method: HTTP_METHOD.PUT };
  inputs = z.object({ name: z.string(), setBefore: z.boolean() });

  /**
   * @param tx - The audited transaction.
   * @param params - `{ name, setBefore }`.
   * @param connection - The caller's connection.
   * @returns The created project.
   */
  async runWithAudit(
    tx: TxHandle,
    params: { name: string; setBefore: boolean },
    connection: AuditedConnection,
  ) {
    const [project] = await tx
      .insert(projects)
      .values({ name: params.name, slug: params.name })
      .returning();
    if (params.setBefore) {
      connection.metadata.auditBefore = { marker: "from the first run" };
    }
    connection.metadata.auditAfter = serializeProject(project);
    return { project: serializeProject(project) };
  }
}

/** Records whether `afterCommit` ran, and can be told to fail in either half. */
class AfterCommitProbe extends AuditedAction {
  name = "test:after-commit-probe";
  description = "Test-only action exercising the afterCommit hook.";
  middleware = [];
  web = { route: "/test/after-commit-probe", method: HTTP_METHOD.PUT };
  inputs = z.object({ name: z.string(), explode: z.boolean() });

  /** Set to `true` by {@link AfterCommitProbe.afterCommit} when it runs. */
  hookRan = false;

  /**
   * @param tx - The audited transaction.
   * @param params - `{ name, explode }`; `explode` rolls the transaction back.
   * @param connection - The caller's connection.
   * @returns The created project.
   */
  async runWithAudit(
    tx: TxHandle,
    params: { name: string; explode: boolean },
    connection: AuditedConnection,
  ) {
    const [project] = await tx
      .insert(projects)
      .values({ name: params.name, slug: params.name })
      .returning();
    connection.metadata.auditAfter = serializeProject(project);
    if (params.explode) throw new Error("the mutation failed");
    return { project: serializeProject(project) };
  }

  /**
   * Always throws, to prove a failing hook cannot fail an already-committed write.
   * @returns Never — always throws.
   */
  async afterCommit(): Promise<void> {
    this.hookRan = true;
    throw new Error("the afterCommit hook failed");
  }
}

describe("the audit row and its mutation share one transaction", () => {
  test("a mutation writes exactly one row, with matching before and after", async () => {
    const createRes = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: "goombas" }),
    });
    expect(createRes.status).toBe(200);
    const { tag } = (await createRes.json()) as ActionResponse<TagCreate>;

    const editRes = await fetch(`${url}/api/tag`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: tag.id,
        name: "goombas-renamed",
      }),
    });
    expect(editRes.status).toBe(200);

    // This suite performs exactly one `tag:edit`, so one row is the whole story.
    const rows = await rowsFor("tag:edit");
    expect(rows.length).toBe(1);

    const row = rows[0];
    expect(row.userId).toBe(universe.peach.userId);
    expect(row.projectId).toBe(universe.projectId);
    expect(row.targetType).toBe("tag");
    expect(row.targetPath).toBe("goombas-renamed");
    expect((row.before as { name: string }).name).toBe("goombas");
    expect((row.after as { name: string }).name).toBe("goombas-renamed");
    expect(row.metadata).toMatchObject({
      projectId: universe.projectId,
      tagId: tag.id,
      name: "goombas-renamed",
    });
  });

  test("a failing mutation rolls back its write AND its audit row", async () => {
    const probe = new RollbackProbe();
    const connection = bareConnection();

    await expect(
      probe.run({ name: "rollback-probe" }, connection),
    ).rejects.toThrow();

    const orphans = await api.db.db
      .select()
      .from(projects)
      .where(eq(projects.name, "rollback-probe"));
    expect(orphans.length).toBe(0);

    const rows = await rowsFor("test:rollback-probe");
    expect(rows.length).toBe(0);
  });

  test("snapshots do not leak between runs on a reused connection", async () => {
    const probe = new IsolationProbe();
    // One connection, two runs — exactly what a long-lived MCP session does.
    const connection = bareConnection();

    await probe.run({ name: "isolation-one", setBefore: true }, connection);
    await probe.run({ name: "isolation-two", setBefore: false }, connection);

    const rows = await rowsFor("test:isolation-probe");
    expect(rows.length).toBe(2);

    // `rowsFor` is newest-first, so [0] is the second run.
    expect(rows[0].before).toBeNull();
    expect((rows[0].after as { name: string }).name).toBe("isolation-two");
    expect(rows[1].before).toEqual({ marker: "from the first run" });
  });
});

describe("bot attribution", () => {
  test("a person's own change names no bot and no one it was made for", async () => {
    // Every row the universe and this suite have written so far was a person
    // acting directly. `actorBotId` and `onBehalfOfUserId` exist for a bot's
    // change to shared state; on a human's row both must be null, or the audit
    // page would attribute a person's decision to a machine.
    const rows = await api.db.db.select().from(auditLogs);
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.filter((r) => r.actorBotId !== null || r.onBehalfOfUserId !== null),
    ).toEqual([]);
  });

  test("audit:list reports both columns, null for a human action", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&action=tag:create&since=${encodeURIComponent(
        daysAgo(1).toISOString(),
      )}`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse<AuditList>;
    expect(body.auditLogs.length).toBeGreaterThan(0);
    for (const entry of body.auditLogs) {
      expect(entry).toHaveProperty("actorBotId", null);
      expect(entry).toHaveProperty("onBehalfOfUserId", null);
    }
  });
});

describe("afterCommit", () => {
  test("a throwing hook does not fail an action that already committed", async () => {
    const probe = new AfterCommitProbe();
    const connection = bareConnection();

    const result = await probe.run(
      { name: "after-commit-ok", explode: false },
      connection,
    );

    expect((result as { project: { name: string } }).project.name).toBe(
      "after-commit-ok",
    );
    expect(probe.hookRan).toBe(true);

    const rows = await rowsFor("test:after-commit-probe");
    expect(rows.length).toBe(1);
  });

  test("the hook does not run at all when the transaction rolls back", async () => {
    const probe = new AfterCommitProbe();
    const connection = bareConnection();

    await expect(
      probe.run({ name: "after-commit-boom", explode: true }, connection),
    ).rejects.toThrow();

    expect(probe.hookRan).toBe(false);

    const orphans = await api.db.db
      .select()
      .from(projects)
      .where(eq(projects.name, "after-commit-boom"));
    expect(orphans.length).toBe(0);
  });
});

describe("secret redaction", () => {
  test("a signup logs no password anywhere in its audit row", async () => {
    const email = "wario@wario.ware";
    const res = await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wario",
        email,
        password: "gimme-da-money",
      }),
    });
    expect(res.status).toBe(200);

    const [row] = await api.db.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "user:create"),
          eq(auditLogs.targetPath, email),
        ),
      );
    expect(row).toBeDefined();

    // Layer one: the params denylist keeps the plaintext out of `metadata`.
    expect(row.metadata).toMatchObject({ name: "Wario", email });
    expect(row.metadata).not.toHaveProperty("password");

    // Layer two: `after` is `serializeUser` output, which never carries the hash.
    expect(row.after).not.toHaveProperty("password_hash");

    // And belt-and-braces: neither the plaintext nor the hash prefix appears
    // anywhere in the serialized row, however deeply nested.
    const dumped = JSON.stringify(row);
    expect(dumped).not.toContain("gimme-da-money");
    expect(dumped).not.toContain("$argon2");
  });

  test("the signup bootstrap logs its project, on the same transaction", async () => {
    const rows = await rowsFor("project:create");
    // One per seeded user (5) plus Wario from the redaction test above.
    expect(rows.length).toBeGreaterThanOrEqual(6);

    const wario = rows.find(
      (r) => (r.metadata as { name?: string }).name === "Wario's Project",
    );
    expect(wario).toBeDefined();
    expect(wario?.projectId).not.toBeNull();
    expect(wario?.targetType).toBe("project");
    expect((wario?.after as { name: string }).name).toBe("Wario's Project");
  });
});

describe("scoping", () => {
  test("invite:accept files its row against the invite's project", async () => {
    // Every seeded member joined through the real invite flow, so the shared
    // project already carries three of these — none of which name a project in
    // their params.
    const rows = await rowsFor("invite:accept");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.projectId).toBe(universe.projectId);
      expect(row.targetType).toBe("invite");
    }
  });

  test("user:edit is deliberately project-less", async () => {
    const res = await fetch(`${url}/api/user`, {
      method: "POST",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({ name: "Toadsworth" }),
    });
    expect(res.status).toBe(200);

    const rows = await rowsFor("user:edit");
    expect(rows.length).toBe(1);
    expect(rows[0].projectId).toBeNull();
    expect((rows[0].before as { name: string }).name).toBe("Toad");
    expect((rows[0].after as { name: string }).name).toBe("Toadsworth");
  });
});

describe("audit:list", () => {
  const since = () => daysAgo(7).toISOString();

  test("an admin gets a newest-first, paginated page", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${encodeURIComponent(
        since(),
      )}&limit=5`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as ActionResponse<AuditList>;
    expect(body.auditLogs.length).toBeGreaterThan(0);
    expect(body.auditLogs.length).toBeLessThanOrEqual(5);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBeGreaterThan(0);

    const timestamps = body.auditLogs.map((l) => l.createdAt);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    // Epoch milliseconds, per the serializer convention.
    expect(typeof body.auditLogs[0].createdAt).toBe("number");

    for (const entry of body.auditLogs) {
      expect(entry.projectId).toBe(universe.projectId);
    }
  });

  test("a plain member is refused", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${encodeURIComponent(
        since(),
      )}`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    expect(res.status).toBe(403);
  });

  test("an outsider is refused", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${encodeURIComponent(
        since(),
      )}`,
      { headers: cookieHeader(universe.bowser.sessionId) },
    );
    expect(res.status).toBe(403);
  });

  test("the action filter narrows to one action name", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${encodeURIComponent(
        since(),
      )}&action=tag:create&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const body = (await res.json()) as ActionResponse<AuditList>;

    expect(body.auditLogs.length).toBeGreaterThan(0);
    for (const entry of body.auditLogs) {
      expect(entry.action).toBe("tag:create");
    }

    const unfiltered = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${encodeURIComponent(
        since(),
      )}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const all = (await unfiltered.json()) as ActionResponse<AuditList>;
    expect(all.pagination.total).toBeGreaterThan(body.pagination.total);
  });

  test("since and until accept epoch milliseconds, and exclude what is outside", async () => {
    const inRange = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}&since=${daysAgo(1).getTime()}`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const recent = (await inRange.json()) as ActionResponse<AuditList>;
    expect(recent.pagination.total).toBeGreaterThan(0);

    const outOfRange = await fetch(
      `${url}/api/audit-logs?projectId=${universe.projectId}` +
        `&since=${daysAgo(90).getTime()}&until=${daysAgo(60).getTime()}`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const stale = (await outOfRange.json()) as ActionResponse<AuditList>;
    expect(stale.pagination.total).toBe(0);
  });

  test("one project's log never contains another's", async () => {
    const res = await fetch(
      `${url}/api/audit-logs?projectId=${universe.bowser.projectId}&since=${encodeURIComponent(
        since(),
      )}&limit=100`,
      { headers: cookieHeader(universe.bowser.sessionId) },
    );
    const body = (await res.json()) as ActionResponse<AuditList>;
    for (const entry of body.auditLogs) {
      expect(entry.projectId).toBe(universe.bowser.projectId);
    }
  });
});

describe("project deletion", () => {
  test("a deleted project keeps its audit trail, including its own deletion", async () => {
    const createRes = await fetch(`${url}/api/project`, {
      method: "PUT",
      headers: authHeaders(universe.luigi.sessionId),
      body: JSON.stringify({ name: "Doomed Project" }),
    });
    const { project } = (await createRes.json()) as {
      project: { id: number; name: string };
    };

    const deleteRes = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: authHeaders(universe.luigi.sessionId),
      body: JSON.stringify({ projectId: project.id }),
    });
    expect(deleteRes.status).toBe(200);

    expect(
      (
        await api.db.db
          .select()
          .from(projects)
          .where(eq(projects.id, project.id))
      ).length,
    ).toBe(0);

    // No foreign key on `audit_logs.projectId`, so nothing cascaded these away.
    const surviving = await api.db.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectId, project.id))
      .orderBy(desc(auditLogs.id));

    expect(surviving.map((r) => r.action)).toContain("project:create");
    expect(surviving.map((r) => r.action)).toContain("project:delete");

    const deletion = surviving.find((r) => r.action === "project:delete");
    expect((deletion?.before as { name: string }).name).toBe("Doomed Project");
    expect(deletion?.after).toBeNull();
  });
});

describe("audit:sweep", () => {
  test("deletes only what is past config.audit.retentionDays", async () => {
    const original = config.audit.retentionDays;

    const [ancient] = await api.db.db
      .insert(auditLogs)
      .values({
        action: "test:ancient",
        projectId: universe.projectId,
        createdAt: daysAgo(200),
      })
      .returning();

    try {
      // A retention window wider than the row's age keeps it — and proves the
      // sweep is not simply deleting everything.
      config.audit.retentionDays = 365;
      expect(
        ((await runAction("audit:sweep")) as { deleted: number }).deleted,
      ).toBe(0);
      expect((await rowsFor("test:ancient")).length).toBe(1);

      config.audit.retentionDays = 90;
      expect(
        ((await runAction("audit:sweep")) as { deleted: number }).deleted,
      ).toBe(1);
      expect((await rowsFor("test:ancient")).length).toBe(0);

      // Everything written by this suite is minutes old, so it all survives.
      const recent = await api.db.db
        .select()
        .from(auditLogs)
        .where(like(auditLogs.action, "tag:%"));
      expect(recent.length).toBeGreaterThan(0);
    } finally {
      config.audit.retentionDays = original;
      await api.db.db.delete(auditLogs).where(eq(auditLogs.id, ancient.id));
    }
  });

  test("is not itself audited — a retention sweep is not somebody's decision", async () => {
    expect((await rowsFor("audit:sweep")).length).toBe(0);
    expect((await rowsFor("audit:list")).length).toBe(0);
    expect((await rowsFor("session:create")).length).toBe(0);
    expect((await rowsFor("project:view")).length).toBe(0);
  });
});
