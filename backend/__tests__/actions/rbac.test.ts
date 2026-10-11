import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ActionResponse, api } from "keryx";
import type { ActionsPermissions } from "../../actions/actions-permissions";
import type { ProjectView } from "../../actions/project/project-view";
import { RBAC_LEVELS, type RbacLevel } from "../../middleware/rbac";
import {
  NEVER_MCP_ACTION_NAMES,
  NEVER_MCP_ACTION_PREFIXES,
  shouldPublishAsMcpTool,
} from "../../ops/McpToolPolicyOps";
import { ADMIN_TAG } from "../../ops/TagOps";
import {
  authHeaders,
  buildTestUniverse,
  cookieHeader,
  HOOK_TIMEOUT,
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

describe("actions:permissions", () => {
  test("needs no auth and reports a known level for every action", async () => {
    const res = await fetch(`${url}/api/actions/permissions`);
    expect(res.status).toBe(200);

    const { permissions } =
      (await res.json()) as ActionResponse<ActionsPermissions>;

    expect(Object.keys(permissions).length).toBeGreaterThan(0);
    for (const [name, requirement] of Object.entries(permissions)) {
      expect(
        RBAC_LEVELS.includes(requirement.type as RbacLevel),
        `${name} reported an unknown level: ${requirement.type}`,
      ).toBe(true);
    }
  });

  test("mirrors what the middleware actually enforces", async () => {
    const res = await fetch(`${url}/api/actions/permissions`);
    const { permissions } =
      (await res.json()) as ActionResponse<ActionsPermissions>;

    // Member-gated reads: membership grants read.
    for (const name of ["project:view", "membership:list", "tag:list"]) {
      expect(permissions[name]?.type, name).toBe("member");
    }

    // Admin-gated writes: the reserved `admin` tag grants administration.
    for (const name of [
      "project:edit",
      "project:delete",
      "membership:create",
      "membership:delete",
      "tag:create",
      "tag:edit",
      "tag:delete",
      "user-tag:assign",
      "user-tag:remove",
      "invite:create",
      "invite:list",
      "audit:list",
    ]) {
      expect(permissions[name]?.type, name).toBe("admin");
    }

    // Not project-scoped: these are session-scoped or public, and saying `none`
    // here is correct rather than an omission.
    for (const name of [
      "status",
      "swagger",
      "actions:permissions",
      "user:create",
      "user:edit",
      "session:create",
      "session:destroy",
      "me:view",
      "project:create",
      "project:list",
      "invite:list-pending",
      "invite:accept",
      "invite:reject",
      "audit:sweep",
      "invites:sweep",
    ]) {
      expect(permissions[name]?.type, name).toBe("none");
    }
  });

  test("the expectation above covers every registered action", async () => {
    // A new action that nobody added to the lists above would otherwise ship
    // with whatever level it happened to declare and no test saying so.
    const res = await fetch(`${url}/api/actions/permissions`);
    const { permissions } =
      (await res.json()) as ActionResponse<ActionsPermissions>;
    expect(Object.keys(permissions).sort()).toEqual(
      api.actions.actions.map((a) => a.name).sort(),
    );
    expect(Object.keys(permissions).length).toBe(30);
  });

  test("retention sweeps are task-only — no public HTTP routes", () => {
    // Defense-in-depth for the public API: a clock with a `web` route is an
    // unauthenticated control-plane endpoint.
    for (const name of ["audit:sweep", "invites:sweep"]) {
      const action = api.actions.actions.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      expect(action?.web?.route, name).toBeUndefined();
      expect(action?.task?.queue, name).toBe("default");
      expect(action?.task?.frequency ?? 0, name).toBeGreaterThan(0);
    }
  });

  test("no clock has a web route", () => {
    // The general rule the sweeps above are instances of, derived from the live
    // registry so the next clock is covered without being named here.
    const clocks = api.actions.actions.filter(
      (a) => (a.task?.frequency ?? 0) > 0,
    );
    expect(clocks.length).toBeGreaterThan(0);
    for (const action of clocks) {
      expect(action.web?.route, action.name).toBeUndefined();
    }
  });

  test("every action's mcp.tool flag matches the publish policy", () => {
    // Human MCP ≈ HTTP: almost every action with a web route is a tool.
    // Class-level `mcp.tool` is the boot default; `applyMcpToolPolicy` overwrites
    // it, so this is the assertion that the live registry matches the function.
    for (const action of api.actions.actions) {
      expect(action.mcp?.tool ?? false, action.name).toBe(
        shouldPublishAsMcpTool(action),
      );
    }
  });

  test("every name on the never-MCP list is a registered action", () => {
    // A typo here would leave the real action published while the list reads as
    // though it were not, and nothing else would notice.
    const registered = new Set(api.actions.actions.map((a) => a.name));
    for (const name of NEVER_MCP_ACTION_NAMES) {
      expect(registered.has(name), name).toBe(true);
    }
  });

  test("every never-MCP action has a web route and is not a tool", () => {
    // The list exists for actions the general rule would otherwise publish, so
    // each member must be one the rule would have caught: routed, not a clock.
    for (const name of NEVER_MCP_ACTION_NAMES) {
      const action = api.actions.actions.find((a) => a.name === name);
      expect(action?.web?.route, name).toBeTruthy();
      expect(action?.mcp?.tool, name).toBe(false);
    }
  });

  test("the never-MCP prefixes refuse names nothing has registered", () => {
    // `webhook:*` and `gateway:oauth-*` have no members in the registry, and the
    // rule must already refuse them — so the first one to arrive is not a tool
    // by omission.
    expect([...NEVER_MCP_ACTION_PREFIXES].sort()).toEqual([
      "gateway:oauth-",
      "webhook:",
    ]);
    for (const name of ["webhook:trigger", "gateway:oauth-start"]) {
      expect(
        shouldPublishAsMcpTool({ name, web: { route: `/${name}` } }),
        name,
      ).toBe(false);
    }
    expect(
      shouldPublishAsMcpTool({ name: "thing:view", web: { route: "/thing" } }),
    ).toBe(true);
    expect(
      shouldPublishAsMcpTool({
        name: "thing:tick",
        web: { route: "/thing/tick" },
        task: { frequency: 1000 },
      }),
    ).toBe(false);
  });

  test("every action taking a projectId declares member or admin", async () => {
    const res = await fetch(`${url}/api/actions/permissions`);
    const { permissions } =
      (await res.json()) as ActionResponse<ActionsPermissions>;

    // Derived from the live registry, so an action added later that accepts a
    // `projectId` but forgets its RBAC middleware fails this test rather than
    // shipping unguarded.
    let checked = 0;
    for (const action of api.actions.actions) {
      const shape = (
        action.inputs as unknown as { shape?: Record<string, unknown> }
      )?.shape;
      if (!shape || !("projectId" in shape)) continue;
      checked++;
      expect(
        permissions[action.name]?.type,
        `${action.name} accepts projectId but declares no RBAC requirement`,
      ).not.toBe("none");
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("RBAC enforcement", () => {
  test("an outsider is refused a member-level action", async () => {
    const res = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.bowser.sessionId) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("not a member");
  });

  test("a member is allowed a member-level action", async () => {
    const res = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    expect(res.status).toBe(200);
  });

  test("a member without the admin tag is refused an admin-level action", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.mario.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: "plumbers" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("admin");
  });

  test("an admin is allowed the same admin-level action", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: "plumbers" }),
    });
    expect(res.status).toBe(200);
  });

  test("a signed-out caller is 401, not 403", async () => {
    const res = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
    );
    expect(res.status).toBe(401);
  });

  test("tags do not leak across projects: an admin of one is an outsider to another", async () => {
    // Bowser administers his own bootstrap project, which must not grant him
    // anything in Peach's.
    const own = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.bowser.sessionId),
      body: JSON.stringify({
        projectId: universe.bowser.projectId,
        name: "koopas",
      }),
    });
    expect(own.status).toBe(200);

    const theirs = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.bowser.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: "koopas" }),
    });
    expect(theirs.status).toBe(403);
  });

  test("project:view answers standing, so no client has to know the tag is called 'admin'", async () => {
    const asAdmin = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const adminBody = (await asAdmin.json()) as ActionResponse<ProjectView>;
    expect(adminBody.standing).toEqual({ isMember: true, isAdmin: true });
    // Reserved-ness is reported per tag too, for the same reason.
    expect(
      adminBody.callerTags.find((t) => t.name === ADMIN_TAG)?.reserved,
    ).toBe(true);

    const asMember = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    const memberBody = (await asMember.json()) as ActionResponse<ProjectView>;
    expect(memberBody.standing).toEqual({ isMember: true, isAdmin: false });
    expect(memberBody.callerTags).toEqual([]);
  });

  test("a missing projectId is a validation error, not a 500", async () => {
    const res = await fetch(`${url}/api/tags`, {
      headers: cookieHeader(universe.peach.sessionId),
    });
    expect(res.status).toBe(406);
  });
});
