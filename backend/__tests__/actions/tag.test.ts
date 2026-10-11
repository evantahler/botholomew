import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ActionResponse, api } from "keryx";
import type { MembershipList } from "../../actions/membership/membership-list";
import type { TagCreate } from "../../actions/tag/tag-create";
import type { TagList } from "../../actions/tag/tag-list";
import { ADMIN_TAG } from "../../ops/TagOps";
import {
  authHeaders,
  buildTestUniverse,
  cookieHeader,
  createTag,
  HOOK_TIMEOUT,
  type TestUniverse,
} from "../setup";

let universe: TestUniverse;
let url: string;
let adminTagId: number;

beforeAll(async () => {
  universe = await buildTestUniverse();
  url = universe.url;

  const res = await fetch(`${url}/api/tags?projectId=${universe.projectId}`, {
    headers: cookieHeader(universe.peach.sessionId),
  });
  const body = (await res.json()) as ActionResponse<TagList>;
  adminTagId = body.tags.find((t) => t.name === ADMIN_TAG)!.id;
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("the reserved admin tag", () => {
  test("cannot be created", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: ADMIN_TAG }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("reserved");
  });

  test("cannot be created under a different case or with padding", async () => {
    for (const name of ["Admin", "  ADMIN  "]) {
      const res = await fetch(`${url}/api/tag`, {
        method: "PUT",
        headers: authHeaders(universe.peach.sessionId),
        body: JSON.stringify({ projectId: universe.projectId, name }),
      });
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error?.message, name).toContain("reserved");
    }
  });

  test("cannot be renamed", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: adminTagId,
        name: "superuser",
      }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("reserved");
  });

  test("cannot be impersonated by renaming another tag to it", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: universe.tagIds.viewers,
        name: ADMIN_TAG,
      }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("reserved");
  });

  test("cannot be deleted", async () => {
    const res = await fetch(`${url}/api/tag`, {
      method: "DELETE",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: adminTagId,
      }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("reserved");

    // Still there, and still administering.
    const list = await fetch(
      `${url}/api/tags?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const listBody = (await list.json()) as ActionResponse<TagList>;
    expect(listBody.tags.map((t) => t.name)).toContain(ADMIN_TAG);
  });
});

describe("tag:create / tag:edit / tag:delete", () => {
  test("tag names are unique per project but reusable across projects", async () => {
    const duplicate = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        name: "viewers",
      }),
    });
    const body = (await duplicate.json()) as { error?: { key?: string } };
    expect(body.error?.key).toBe("name");

    // The same name in a different project is fine — tags are project-scoped.
    const elsewhere = await createTag(
      url,
      universe.bowser,
      universe.bowser.projectId,
      "viewers",
    );
    expect(elsewhere).toBeGreaterThan(0);
  });

  test("a rename that collides with a sibling is refused", async () => {
    const created = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, name: "auditors" }),
    });
    const { tag } = (await created.json()) as ActionResponse<TagCreate>;

    const res = await fetch(`${url}/api/tag`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: tag.id,
        name: "viewers",
      }),
    });
    const body = (await res.json()) as { error?: { key?: string } };
    expect(body.error?.key).toBe("name");
  });

  test("a tag from another project cannot be edited or deleted through this one", async () => {
    const foreign = await createTag(
      url,
      universe.bowser,
      universe.bowser.projectId,
      "castles",
    );

    const edit = await fetch(`${url}/api/tag`, {
      method: "POST",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        tagId: foreign,
        name: "renamed",
      }),
    });
    expect(edit.status).toBe(404);

    const del = await fetch(`${url}/api/tag`, {
      method: "DELETE",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, tagId: foreign }),
    });
    expect(del.status).toBe(404);
  });

  test("deleting a tag revokes it from everyone holding it", async () => {
    const tagId = await createTag(
      url,
      universe.peach,
      universe.projectId,
      "temporary",
    );

    await fetch(`${url}/api/user-tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        userId: universe.toad.userId,
        tagId,
      }),
    });

    const before = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const beforeBody = (await before.json()) as ActionResponse<MembershipList>;
    const toadBefore = beforeBody.memberships.find(
      (m) => m.userId === universe.toad.userId,
    );
    expect(toadBefore?.tags.map((t) => t.name)).toContain("temporary");

    await fetch(`${url}/api/tag`, {
      method: "DELETE",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, tagId }),
    });

    const after = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const afterBody = (await after.json()) as ActionResponse<MembershipList>;
    const toadAfter = afterBody.memberships.find(
      (m) => m.userId === universe.toad.userId,
    );
    expect(toadAfter?.tags.map((t) => t.name)).not.toContain("temporary");
  });
});

describe("tag:list", () => {
  test("is readable by any member and paginates", async () => {
    const all = await fetch(
      `${url}/api/tags?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as ActionResponse<TagList>;
    expect(allBody.tags.length).toBeGreaterThan(1);

    const page = await fetch(
      `${url}/api/tags?projectId=${universe.projectId}&limit=1&page=2`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    const pageBody = (await page.json()) as ActionResponse<TagList>;
    expect(pageBody.tags.length).toBe(1);
    expect(pageBody.pagination.total).toBe(allBody.pagination.total);
    expect(pageBody.pagination.pages).toBe(allBody.pagination.total);
    // Ordered by name, so page 2 of a 1-per-page walk is the second tag.
    expect(pageBody.tags[0].id).toBe(allBody.tags[1].id);
  });

  test("an outsider cannot list a project's tags", async () => {
    const res = await fetch(
      `${url}/api/tags?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.bowser.sessionId) },
    );
    expect(res.status).toBe(403);
  });
});
