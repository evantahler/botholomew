import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type ActionResponse, api } from "keryx";
import type { MeView } from "../../actions/me";
import type { UserCreate } from "../../actions/user";
import type { UserEdit } from "../../actions/user-edit";
import { ADMIN_TAG } from "../../ops/TagOps";
import { projectMemberships } from "../../schema/project_memberships";
import { tags } from "../../schema/tags";
import { userTags } from "../../schema/user_tags";
import {
  authHeaders,
  cookieHeader,
  createUserAndLogin,
  HOOK_TIMEOUT,
  retryClearDatabase,
  serverUrl,
  TEST_PASSWORD,
} from "../setup";

let url: string;

beforeAll(async () => {
  await api.start();
  url = serverUrl();
  await retryClearDatabase();
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("user:create", () => {
  test("bootstraps a user, their project, membership, and admin tag", async () => {
    const res = await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Daisy",
        email: "Daisy@Sarasaland.com",
        password: TEST_PASSWORD,
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as ActionResponse<UserCreate>;
    // The email is lowercased by the schema's transform, not stored as typed.
    expect(body.user.email).toBe("daisy@sarasaland.com");
    expect(body.project.name).toBe("Daisy's Project");
    expect(body.project.slug).toBe("daisy-s-project");
    expect(body.membership.projectId).toBe(body.project.id);
    expect(body.membership.userId).toBe(body.user.id);
    // Serializers emit epoch ms, and never the password hash.
    expect(typeof body.user.createdAt).toBe("number");
    expect(body.user).not.toHaveProperty("password_hash");

    // The bootstrap's fourth write: the owner actually holds the admin tag.
    const [adminTag] = await api.db.db
      .select()
      .from(tags)
      .where(eq(tags.projectId, body.project.id));
    expect(adminTag.name).toBe(ADMIN_TAG);

    const held = await api.db.db
      .select()
      .from(userTags)
      .where(eq(userTags.userId, body.user.id));
    expect(held.map((r) => r.tagId)).toContain(adminTag.id);
  });

  test("rejects a duplicate email case-insensitively, and rolls the bootstrap back", async () => {
    const before = await api.db.db.select().from(projectMemberships);

    const res = await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Daisy Again",
        email: "DAISY@sarasaland.com",
        password: TEST_PASSWORD,
      }),
    });
    // 406, not 500: a hand-thrown validation error uses
    // `CONNECTION_ACTION_PARAM_VALIDATION`, which is the type keryx maps to 406.
    expect(res.status).toBe(406);
    const body = (await res.json()) as {
      error?: { message: string; key?: string };
    };
    expect(body.error?.message).toContain("already exists");
    expect(body.error?.key).toBe("email");

    // The whole bootstrap is one transaction, so a rejected signup leaves no
    // orphan project or membership behind.
    const after = await api.db.db.select().from(projectMemberships);
    expect(after.length).toBe(before.length);
  });

  test("returns a 406 naming the offending field on validation failure", async () => {
    const res = await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wario",
        email: "wario@warioware.com",
        password: "short",
      }),
    });
    expect(res.status).toBe(406);

    const body = (await res.json()) as {
      error?: { message: string; key?: string };
    };
    expect(body.error?.key).toBe("password");
    expect(body.error?.message).toContain("at least 8 characters");
  });

  test("redacts the password from logs", async () => {
    const lines: string[] = [];
    const original = api.logger.info.bind(api.logger);
    api.logger.info = ((message: string, meta?: unknown) => {
      lines.push(`${message} ${JSON.stringify(meta ?? {})}`);
      return original(message, meta as never);
    }) as typeof api.logger.info;

    try {
      await fetch(`${url}/api/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Waluigi",
          email: "waluigi@warioware.com",
          password: "hunter2hunter2",
        }),
      });
    } finally {
      api.logger.info = original;
    }

    const logged = lines.join("\n");
    expect(logged).not.toContain("hunter2hunter2");
    // `secret()` is what does this: the param is logged as a redaction marker.
    expect(logged).toContain("[[secret]]");
  });
});

describe("user:edit and me:view", () => {
  test("edits only the caller's own record, from the session", async () => {
    const luigi = await createUserAndLogin(
      url,
      "Luigi",
      "luigi@mushroom.kingdom",
      TEST_PASSWORD,
    );

    const res = await fetch(`${url}/api/user`, {
      method: "POST",
      headers: authHeaders(luigi.sessionId),
      body: JSON.stringify({ name: "Luigi Mario" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse<UserEdit>;
    expect(body.user.id).toBe(luigi.userId);
    expect(body.user.name).toBe("Luigi Mario");

    const meRes = await fetch(`${url}/api/me`, {
      headers: cookieHeader(luigi.sessionId),
    });
    const me = (await meRes.json()) as ActionResponse<MeView>;
    expect(me.user.name).toBe("Luigi Mario");
  });

  test("refuses an email already taken by someone else", async () => {
    const toad = await createUserAndLogin(
      url,
      "Toad",
      "toad@mushroom.kingdom",
      TEST_PASSWORD,
    );

    const res = await fetch(`${url}/api/user`, {
      method: "POST",
      headers: authHeaders(toad.sessionId),
      body: JSON.stringify({ email: "luigi@mushroom.kingdom" }),
    });
    const body = (await res.json()) as { error?: { key?: string } };
    expect(body.error?.key).toBe("email");
  });

  test("changing the password lets the new one sign in and retires the old", async () => {
    const peach = await createUserAndLogin(
      url,
      "Peach",
      "peach@mushroom.kingdom",
      TEST_PASSWORD,
    );

    const editRes = await fetch(`${url}/api/user`, {
      method: "POST",
      headers: authHeaders(peach.sessionId),
      body: JSON.stringify({ password: "toadstool-castle" }),
    });
    expect(editRes.status).toBe(200);

    const goodLogin = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: peach.email,
        password: "toadstool-castle",
      }),
    });
    expect(goodLogin.status).toBe(200);

    const staleLogin = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: peach.email, password: TEST_PASSWORD }),
    });
    expect(staleLogin.status).not.toBe(200);
  });

  test("me:view is 401 without a session", async () => {
    const res = await fetch(`${url}/api/me`);
    expect(res.status).toBe(401);
  });
});
