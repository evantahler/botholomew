import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type ActionResponse, api } from "keryx";
import type { InviteCreate } from "../../actions/invite/invite-create";
import type { InviteList } from "../../actions/invite/invite-list";
import type { InviteListPending } from "../../actions/invite/invite-list-pending";
import type { InvitesSweep } from "../../actions/invite/invites-sweep";
import type { MembershipList } from "../../actions/membership/membership-list";
import { INVITE_STATUS, INVITE_TTL_MS } from "../../ops/InviteOps";
import { projectInvites } from "../../schema/project_invites";
import {
  authHeaders,
  buildTestUniverse,
  cookieHeader,
  createUserAndLogin,
  HOOK_TIMEOUT,
  runAction,
  TEST_PASSWORD,
  type TestUniverse,
  type TestUser,
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
 * Issue an invite to the shared project as Peach (its admin).
 * @param inviteeEmail - Who to invite.
 * @param tagIds - Tags to grant on acceptance.
 * @returns The raw `fetch` response, so callers can assert on failures too.
 */
async function invite(
  inviteeEmail: string,
  tagIds: number[] = [],
): Promise<Response> {
  return fetch(`${url}/api/invite`, {
    method: "PUT",
    headers: authHeaders(universe.peach.sessionId),
    body: JSON.stringify({
      projectId: universe.projectId,
      inviteeEmail,
      tagIds,
    }),
  });
}

/**
 * List the pending invites addressed to a user.
 * @param user - The signed-in invitee.
 * @returns Their pending invites.
 */
async function pendingFor(
  user: TestUser,
): Promise<ActionResponse<InviteListPending>["invites"]> {
  const res = await fetch(`${url}/api/invites/pending?limit=100`, {
    headers: cookieHeader(user.sessionId),
  });
  const body = (await res.json()) as ActionResponse<InviteListPending>;
  return body.invites;
}

describe("invite:create", () => {
  test("denormalizes the inviter and project, and expires in five days", async () => {
    const res = await invite("daisy@sarasaland.com", [
      universe.tagIds.operators,
    ]);
    expect(res.status).toBe(200);

    const { invite: created } =
      (await res.json()) as ActionResponse<InviteCreate>;
    expect(created.status).toBe(INVITE_STATUS.pending);
    expect(created.inviterEmail).toBe(universe.peach.email);
    expect(created.projectName).toBeTruthy();
    expect(created.tagIds).toEqual([universe.tagIds.operators]);

    // Five days out, give or take the round trip. This is also the assertion that
    // catches a timestamp-zone regression: `createdAt` comes from Postgres and
    // `expiresAt` from the app, so if the two disagree about what instant a naked
    // timestamp names, this drifts by the server's UTC offset.
    const ttl = created.expiresAt - created.createdAt;
    expect(Math.abs(ttl - INVITE_TTL_MS)).toBeLessThan(5_000);
  });

  test("lowercases the invitee email", async () => {
    const res = await invite("YOSHI@Mushroom.Kingdom");
    const { invite: created } =
      (await res.json()) as ActionResponse<InviteCreate>;
    expect(created.inviteeEmail).toBe("yoshi@mushroom.kingdom");
  });

  test("refuses tag ids that belong to another project", async () => {
    const foreignTagRes = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.bowser.sessionId),
      body: JSON.stringify({
        projectId: universe.bowser.projectId,
        name: "minions",
      }),
    });
    const { tag } = (await foreignTagRes.json()) as { tag: { id: number } };

    const res = await invite("wario@warioware.com", [tag.id]);
    expect(res.status).toBe(406);
    const body = (await res.json()) as { error?: { key?: string } };
    expect(body.error?.key).toBe("tagIds");
  });

  test("a plain member cannot invite", async () => {
    const res = await fetch(`${url}/api/invite`, {
      method: "PUT",
      headers: authHeaders(universe.toad.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        inviteeEmail: "wario@warioware.com",
        tagIds: [],
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("invite:list-pending", () => {
  test("finds invites by email for a user with no memberships at all", async () => {
    // Daisy was invited above, before she had an account. She signs up now: her
    // bootstrap project is her only membership, and the invite must still be here.
    const daisy = await createUserAndLogin(
      url,
      "Daisy",
      "daisy@sarasaland.com",
      TEST_PASSWORD,
    );

    const invites = await pendingFor(daisy);
    expect(invites.length).toBe(1);
    expect(invites[0].projectId).toBe(universe.projectId);
  });

  test("does not show invites addressed to someone else", async () => {
    const invites = await pendingFor(universe.bowser);
    expect(invites).toEqual([]);
  });

  test("paginates", async () => {
    const first = await fetch(`${url}/api/invites/pending?limit=1&page=1`, {
      headers: cookieHeader(universe.peach.sessionId),
    });
    const body = (await first.json()) as ActionResponse<InviteListPending>;
    expect(body.pagination.limit).toBe(1);
    expect(body.invites.length).toBeLessThanOrEqual(1);
  });
});

describe("invite:accept", () => {
  test("creates the membership, grants the tags, and marks the invite accepted", async () => {
    const daisy = {
      ...(await createUserAndLogin(
        url,
        "Daisy Two",
        "daisy2@sarasaland.com",
        TEST_PASSWORD,
      )),
    };
    await invite(daisy.email, [universe.tagIds.viewers]);

    const [pending] = await pendingFor(daisy);
    const res = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(daisy.sessionId),
      body: JSON.stringify({ inviteId: pending.id }),
    });
    expect(res.status).toBe(200);

    const members = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const membersBody =
      (await members.json()) as ActionResponse<MembershipList>;
    const row = membersBody.memberships.find((m) => m.userId === daisy.userId);
    expect(row).toBeDefined();
    expect(row?.tags.map((t) => t.name)).toEqual(["viewers"]);

    // Not pending for her any more.
    expect(await pendingFor(daisy)).toEqual([]);
  });

  test("is idempotent: accepting twice converges instead of erroring", async () => {
    const luigiInvite = await invite(universe.luigi.email, [
      universe.tagIds.operators,
    ]);
    const { invite: created } =
      (await luigiInvite.json()) as ActionResponse<InviteCreate>;

    // Luigi is already a member with `viewers`; accepting adds `operators` and
    // leaves his single membership alone.
    const first = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(universe.luigi.sessionId),
      body: JSON.stringify({ inviteId: created.id }),
    });
    expect(first.status).toBe(200);

    const members = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const membersBody =
      (await members.json()) as ActionResponse<MembershipList>;
    const luigiRows = membersBody.memberships.filter(
      (m) => m.userId === universe.luigi.userId,
    );
    expect(luigiRows.length).toBe(1);
    expect(luigiRows[0].tags.map((t) => t.name).sort()).toEqual([
      "operators",
      "viewers",
    ]);

    // Re-accepting an already-accepted invite is refused as not valid, and
    // changes nothing.
    const second = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(universe.luigi.sessionId),
      body: JSON.stringify({ inviteId: created.id }),
    });
    expect(second.status).toBe(406);
  });

  test("another user cannot accept an invite addressed to a different email", async () => {
    const res = await invite("wario@warioware.com");
    const { invite: created } =
      (await res.json()) as ActionResponse<InviteCreate>;

    const attempt = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(universe.bowser.sessionId),
      body: JSON.stringify({ inviteId: created.id }),
    });
    // 404, not 403: the invite is simply not addressed to him, and saying more
    // would confirm that some invite with that id exists.
    expect(attempt.status).toBe(404);

    const members = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const membersBody =
      (await members.json()) as ActionResponse<MembershipList>;
    expect(membersBody.memberships.map((m) => m.userId)).not.toContain(
      universe.bowser.userId,
    );
  });

  test("an expired invite is refused", async () => {
    const toadInvite = await invite("expired@mushroom.kingdom");
    const { invite: created } =
      (await toadInvite.json()) as ActionResponse<InviteCreate>;

    // Backdate the expiry rather than waiting five days.
    await api.db.db
      .update(projectInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvites.id, created.id));

    const expiredUser = await createUserAndLogin(
      url,
      "Expired Guest",
      "expired@mushroom.kingdom",
      TEST_PASSWORD,
    );

    // It does not even surface as pending…
    expect(await pendingFor(expiredUser)).toEqual([]);

    // …and accepting it by id is refused.
    const attempt = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(expiredUser.sessionId),
      body: JSON.stringify({ inviteId: created.id }),
    });
    expect(attempt.status).toBe(406);
    const body = (await attempt.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain("no longer valid");
  });

  test("skips tags removed from the project since the invite was written", async () => {
    const tagRes = await fetch(`${url}/api/tag`, {
      method: "PUT",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({
        projectId: universe.projectId,
        name: "ephemeral",
      }),
    });
    const { tag } = (await tagRes.json()) as { tag: { id: number } };

    const guest = await createUserAndLogin(
      url,
      "Nabbit",
      "nabbit@mushroom.kingdom",
      TEST_PASSWORD,
    );
    await invite(guest.email, [tag.id, universe.tagIds.viewers]);

    await fetch(`${url}/api/tag`, {
      method: "DELETE",
      headers: authHeaders(universe.peach.sessionId),
      body: JSON.stringify({ projectId: universe.projectId, tagId: tag.id }),
    });

    const [pending] = await pendingFor(guest);
    const accept = await fetch(`${url}/api/invite/accept`, {
      method: "POST",
      headers: authHeaders(guest.sessionId),
      body: JSON.stringify({ inviteId: pending.id }),
    });
    // The deleted tag is skipped rather than failing the whole acceptance.
    expect(accept.status).toBe(200);

    const members = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const membersBody =
      (await members.json()) as ActionResponse<MembershipList>;
    const row = membersBody.memberships.find((m) => m.userId === guest.userId);
    expect(row?.tags.map((t) => t.name)).toEqual(["viewers"]);
  });
});

describe("invite:reject", () => {
  test("marks the invite rejected and creates no membership", async () => {
    const guest = await createUserAndLogin(
      url,
      "Birdo",
      "birdo@mushroom.kingdom",
      TEST_PASSWORD,
    );
    await invite(guest.email, [universe.tagIds.viewers]);

    const [pending] = await pendingFor(guest);
    const res = await fetch(`${url}/api/invite/reject`, {
      method: "POST",
      headers: authHeaders(guest.sessionId),
      body: JSON.stringify({ inviteId: pending.id }),
    });
    expect(res.status).toBe(200);

    expect(await pendingFor(guest)).toEqual([]);

    const members = await fetch(
      `${url}/api/memberships?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const membersBody =
      (await members.json()) as ActionResponse<MembershipList>;
    expect(membersBody.memberships.map((m) => m.userId)).not.toContain(
      guest.userId,
    );
  });

  test("cannot reject someone else's invite", async () => {
    const res = await invite("waluigi@warioware.com");
    const { invite: created } =
      (await res.json()) as ActionResponse<InviteCreate>;

    const attempt = await fetch(`${url}/api/invite/reject`, {
      method: "POST",
      headers: authHeaders(universe.bowser.sessionId),
      body: JSON.stringify({ inviteId: created.id }),
    });
    expect(attempt.status).toBe(404);
  });
});

describe("invite:list", () => {
  test("shows an admin every status, and paginates", async () => {
    const all = await fetch(
      `${url}/api/invites?projectId=${universe.projectId}&limit=100`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as ActionResponse<InviteList>;

    const statuses = new Set(allBody.invites.map((i) => i.status));
    expect(statuses.has(INVITE_STATUS.pending)).toBe(true);
    expect(statuses.has(INVITE_STATUS.accepted)).toBe(true);
    expect(statuses.has(INVITE_STATUS.rejected)).toBe(true);

    const page = await fetch(
      `${url}/api/invites?projectId=${universe.projectId}&limit=2&page=2`,
      { headers: cookieHeader(universe.peach.sessionId) },
    );
    const pageBody = (await page.json()) as ActionResponse<InviteList>;
    expect(pageBody.invites.length).toBe(2);
    expect(pageBody.pagination.total).toBe(allBody.pagination.total);
    expect(pageBody.pagination.page).toBe(2);
  });

  test("a plain member cannot list a project's invites", async () => {
    const res = await fetch(
      `${url}/api/invites?projectId=${universe.projectId}`,
      { headers: cookieHeader(universe.toad.sessionId) },
    );
    expect(res.status).toBe(403);
  });
});

describe("invites:sweep", () => {
  test("deletes expired invites and leaves live ones alone", async () => {
    const liveRes = await invite("live@mushroom.kingdom");
    const { invite: live } =
      (await liveRes.json()) as ActionResponse<InviteCreate>;

    const staleRes = await invite("stale@mushroom.kingdom");
    const { invite: stale } =
      (await staleRes.json()) as ActionResponse<InviteCreate>;
    await api.db.db
      .update(projectInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvites.id, stale.id));

    const body = (await runAction(
      "invites:sweep",
    )) as ActionResponse<InvitesSweep>;
    expect(body.deleted).toBeGreaterThanOrEqual(1);

    const remaining = await api.db.db.select().from(projectInvites);
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(stale.id);
  });
});
