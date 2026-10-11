import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ActionResponse, api, config } from "keryx";
import type { SessionCreate } from "../../actions/session";
import {
  cookieHeader,
  createUserAndLogin,
  HOOK_TIMEOUT,
  retryClearDatabase,
  serverUrl,
  TEST_PASSWORD,
  type TestUser,
} from "../setup";

let url: string;
let mario: TestUser;

beforeAll(async () => {
  await api.start();
  url = serverUrl();
  await retryClearDatabase();
  mario = await createUserAndLogin(
    url,
    "Mario",
    "mario@mushroom.kingdom",
    TEST_PASSWORD,
  );
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

/**
 * Sign in over HTTP without going through the fixture, so the raw response —
 * status, `Set-Cookie`, error envelope — is available to assert on.
 * @param email - The email to sign in with.
 * @param password - The password to sign in with.
 * @returns The raw `fetch` response.
 */
async function login(email: string, password: string): Promise<Response> {
  return fetch(`${url}/api/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("session:create", () => {
  test("sets a session cookie and returns the user", async () => {
    const res = await login(mario.email, TEST_PASSWORD);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(config.session.cookieName);
    expect(setCookie).toContain("HttpOnly");

    const body = (await res.json()) as ActionResponse<SessionCreate>;
    expect(body.user.email).toBe(mario.email);
    expect(body.session.id).toBeTruthy();
  });

  test("accepts the email in any case", async () => {
    const res = await login("MARIO@Mushroom.Kingdom", TEST_PASSWORD);
    expect(res.status).toBe(200);
  });

  test("gives the same error for a wrong password and an unknown email", async () => {
    const wrongPassword = await login(mario.email, "not-the-password");
    const unknownEmail = await login("nobody@mushroom.kingdom", TEST_PASSWORD);

    const a = (await wrongPassword.json()) as { error?: { message: string } };
    const b = (await unknownEmail.json()) as { error?: { message: string } };

    // Identical on purpose: a different message would turn this endpoint into an
    // account-enumeration oracle.
    expect(a.error?.message).toBe("Invalid email or password");
    expect(b.error?.message).toBe(a.error?.message);
    expect(wrongPassword.status).toBe(unknownEmail.status);
  });

  test("regenerates the session id across login (fixation defense)", async () => {
    const first = await login(mario.email, TEST_PASSWORD);
    const firstBody = (await first.json()) as ActionResponse<SessionCreate>;

    const second = await login(mario.email, TEST_PASSWORD);
    const secondBody = (await second.json()) as ActionResponse<SessionCreate>;

    // A session id an attacker planted before login must not be the one that
    // ends up authenticated.
    expect(secondBody.session.id).not.toBe(firstBody.session.id);
  });
});

describe("session:destroy", () => {
  test("signs out, after which the session no longer authenticates", async () => {
    const res = await login(mario.email, TEST_PASSWORD);
    const { session } = (await res.json()) as ActionResponse<SessionCreate>;

    const before = await fetch(`${url}/api/me`, {
      headers: cookieHeader(session.id),
    });
    expect(before.status).toBe(200);

    const destroy = await fetch(`${url}/api/session`, {
      method: "DELETE",
      headers: cookieHeader(session.id),
    });
    expect(destroy.status).toBe(200);

    const after = await fetch(`${url}/api/me`, {
      headers: cookieHeader(session.id),
    });
    expect(after.status).toBe(401);
  });

  test("is 401 without a session", async () => {
    const res = await fetch(`${url}/api/session`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
