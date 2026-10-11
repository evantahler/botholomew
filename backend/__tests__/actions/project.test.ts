import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type ActionResponse, api, config } from "keryx";
import type { ProjectCreate } from "../../actions/project/project-create";
import type { ProjectEdit } from "../../actions/project/project-edit";
import type { ProjectList } from "../../actions/project/project-list";
import type { ProjectView } from "../../actions/project/project-view";
import { ADMIN_TAG } from "../../ops/TagOps";
import { auditLogs } from "../../schema/audit_logs";
import { projectInvites } from "../../schema/project_invites";
import { projectMemberships } from "../../schema/project_memberships";
import { projects } from "../../schema/projects";
import { tags } from "../../schema/tags";
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

describe("project:create", () => {
  test("makes the caller the project's admin", async () => {
    const res = await fetch(`${url}/api/project`, {
      method: "PUT",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({ name: "Toad House" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as ActionResponse<ProjectCreate>;
    expect(body.project.slug).toBe("toad-house");
    expect(body.membership.userId).toBe(universe.toad.userId);

    const view = await fetch(
      `${url}/api/project?projectId=${body.project.id}`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    const viewed = (await view.json()) as ActionResponse<ProjectView>;
    expect(viewed.callerTags.map((t) => t.name)).toContain(ADMIN_TAG);
  });

  test("reports where an external MCP client connects", async () => {
    // The address is the server's answer, not something a browser can assemble:
    // the frontend is served from a different origin than the API in every
    // deployed configuration, so a URL built from `window.location` would look
    // right and connect to nothing.
    const res = await fetch(
      `${url}/api/project?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const body = (await res.json()) as ActionResponse<ProjectView>;

    expect(typeof body.mcp.enabled).toBe("boolean");
    expect(body.mcp.url).toStartWith(config.server.web.applicationUrl);
    expect(body.mcp.url).toEndWith(config.server.mcp.route);
    // A trailing slash on either half would produce `//mcp`, which some clients
    // normalize and some send verbatim — and a 404 on a URL somebody copied out
    // of the UI is the least debuggable kind.
    expect(body.mcp.url).not.toContain("//mcp");
  });

  test("rejects a name shorter than 3 characters", async () => {
    const res = await fetch(`${url}/api/project`, {
      method: "PUT",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({ name: "no" }),
    });
    expect(res.status).toBe(406);
  });
});

describe("project:list", () => {
  test("lists only the caller's own memberships", async () => {
    const res = await fetch(`${url}/api/projects?limit=100`, {
      headers: cookieHeader(universe.luigi.sessionId),
    });
    const body = (await res.json()) as ActionResponse<ProjectList>;

    const ids = body.projects.map((p) => p.id);
    expect(ids).toContain(universe.luigi.projectId); // his own bootstrap project
    expect(ids).toContain(universe.projectId); // Peach's, which he joined
    expect(ids).not.toContain(universe.bowser.projectId);
  });

  test("honors limit and offset with correct pagination totals", async () => {
    // Luigi belongs to two projects: his own and Peach's.
    const first = await fetch(`${url}/api/projects?limit=1&page=1`, {
      headers: cookieHeader(universe.luigi.sessionId),
    });
    const firstBody = (await first.json()) as ActionResponse<ProjectList>;
    expect(firstBody.projects.length).toBe(1);
    expect(firstBody.pagination.total).toBe(2);
    expect(firstBody.pagination.pages).toBe(2);
    expect(firstBody.pagination.limit).toBe(1);

    const second = await fetch(`${url}/api/projects?limit=1&page=2`, {
      headers: cookieHeader(universe.luigi.sessionId),
    });
    const secondBody = (await second.json()) as ActionResponse<ProjectList>;
    expect(secondBody.projects.length).toBe(1);
    expect(secondBody.projects[0].id).not.toBe(firstBody.projects[0].id);
  });

  test("is 401 without a session", async () => {
    const res = await fetch(`${url}/api/projects`);
    expect(res.status).toBe(401);
  });
});

describe("project:edit", () => {
  test("an admin renames a project and the slug follows", async () => {
    const res = await fetch(`${url}/api/project`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        name: "Mushroom Castle Ops",
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as ActionResponse<ProjectEdit>;
    expect(body.project.name).toBe("Mushroom Castle Ops");
    expect(body.project.slug).toBe("mushroom-castle-ops");
  });

  test("a plain member cannot rename it", async () => {
    const res = await fetch(`${url}/api/project`, {
      method: "POST",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        name: "Toad Castle Ops",
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("project:delete", () => {
  test("cascades to memberships, tags, and invites", async () => {
    // A throwaway project so the shared universe survives for other tests.
    const createRes = await fetch(`${url}/api/project`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ name: "Temporary Project" }),
    });
    const { project } =
      (await createRes.json()) as ActionResponse<ProjectCreate>;

    await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: project.id, name: "doomed" }),
    });
    await fetch(`${url}/api/invite`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: project.id,
        inviteeEmail: universe.bowser.email,
        tagIds: [],
      }),
    });

    // Rows exist before the delete, so "zero after" below is a real change.
    expect(
      (
        await api.db.db
          .select()
          .from(projectMemberships)
          .where(eq(projectMemberships.projectId, project.id))
      ).length,
    ).toBe(1);
    expect(
      (
        await api.db.db
          .select()
          .from(tags)
          .where(eq(tags.projectId, project.id))
      ).length,
    ).toBe(2); // `admin` from the bootstrap, and `doomed`
    expect(
      (
        await api.db.db
          .select()
          .from(projectInvites)
          .where(eq(projectInvites.projectId, project.id))
      ).length,
    ).toBe(1);

    const deleteRes = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: project.id }),
    });
    expect(deleteRes.status).toBe(200);
    // One statement, so the whole answer is that it happened.
    expect(await deleteRes.json()).toEqual({ success: true });

    // The cascade took every project-scoped row with the project.
    const remaining = await Promise.all([
      api.db.db.select().from(projects).where(eq(projects.id, project.id)),
      api.db.db
        .select()
        .from(projectMemberships)
        .where(eq(projectMemberships.projectId, project.id)),
      api.db.db.select().from(tags).where(eq(tags.projectId, project.id)),
      api.db.db
        .select()
        .from(projectInvites)
        .where(eq(projectInvites.projectId, project.id)),
    ]);
    expect(remaining.map((rows) => rows.length)).toEqual([0, 0, 0, 0]);

    // The audit trail did not go with it: no foreign key on `projectId`.
    const surviving = await api.db.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectId, project.id));
    expect(surviving.map((r) => r.action).sort()).toEqual([
      "invite:create",
      "project:create",
      "project:delete",
      "tag:create",
    ]);

    // Gone for its own admin, and gone from her project list.
    const view = await fetch(`${url}/api/project?projectId=${project.id}`, {
      headers: cookieHeader(universe.peach.sessionId),
    });
    expect(view.status).toBe(403);

    const list = await fetch(`${url}/api/projects?limit=100`, {
      headers: cookieHeader(universe.peach.sessionId),
    });
    const listBody = (await list.json()) as ActionResponse<ProjectList>;
    expect(listBody.projects.map((p) => p.id)).not.toContain(project.id);

    // The invite went with it, so a stale invite cannot resurrect access.
    const pending = await fetch(`${url}/api/invites/pending`, {
      headers: cookieHeader(universe.bowser.sessionId),
    });
    const pendingBody = (await pending.json()) as {
      invites: { projectId: number }[];
    };
    expect(pendingBody.invites.map((i) => i.projectId)).not.toContain(
      project.id,
    );
  });

  test("a plain member cannot delete a project", async () => {
    const res = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({ projectId: universe.projectId }),
    });
    expect(res.status).toBe(403);
  });
});
