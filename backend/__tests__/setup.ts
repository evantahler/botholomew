import { setMaxListeners } from "node:events";
import {
  type ActionResponse,
  api,
  CONNECTION_TYPE,
  Connection,
  config,
  type WebServer,
} from "keryx";
import type { InviteCreate } from "../actions/invite/invite-create";
import type { InviteListPending } from "../actions/invite/invite-list-pending";
import type { SessionCreate } from "../actions/session";
import type { TagCreate } from "../actions/tag/tag-create";
import type { UserCreate } from "../actions/user";
// Must be first: sets `api.rootDir` so the framework can auto-discover actions,
// initializers, and channels before any of them are loaded.
import "../index";

// Each test file boots its own server; the shared event bus can exceed the
// default 10-listener warning threshold when many suites run.
setMaxListeners(999);

/** Generous lifecycle-hook timeout — `api.start()` connects to Postgres + Redis and runs migrations. */
export const HOOK_TIMEOUT = 30_000;

/**
 * Run an action in-process the way a Resque worker would.
 *
 * Orchestration ticks and their child jobs are task-only (no public HTTP
 * route), so suites drive them through {@link Connection.act} rather than
 * `fetch`. Uses `CONNECTION_TYPE.TASK` so middleware that keys off the
 * transport sees the same shape production does.
 * @param name - Registered action name (e.g. `invites:sweep`).
 * @param params - Raw params, validated against the action's Zod inputs.
 * @returns The action's response body.
 * @throws The action's TypedError when it fails.
 */
export async function runAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const connection = new Connection(CONNECTION_TYPE.TASK, `test:${name}`);
  try {
    const { response, error } = await connection.act(name, params);
    if (error) throw error;
    return response as T;
  } finally {
    connection.destroy();
  }
}

/** How long {@link drainTasks} waits for a queue to go quiet. */
const DRAIN_TIMEOUT = 10_000;

/**
 * Wait until a Resque queue is empty and no worker is still inside a job.
 *
 * **Tests that call a task directly are racing the worker that calls it too.**
 * `TASKS_ENABLED` is on in the test environment, so an `afterCommit` hook that
 * enqueues hands a second worker the same rows the suite is about to read or
 * lock. The loser of that race sees "nothing to do", so an assertion about the
 * rows becomes an assertion about who won. Draining first makes the suite the
 * only worker, without weakening what it then asserts.
 *
 * Bounded rather than unbounded: a queue that never empties is a suite bug worth
 * seeing as the assertion that follows, not as a hung file.
 * @param queueName - The queue to wait on.
 */
export async function drainTasks(queueName = "default"): Promise<void> {
  const deadline = Date.now() + DRAIN_TIMEOUT;
  while (Date.now() < deadline) {
    const queued = await api.resque.queue.length(queueName);
    const working = await api.resque.queue.allWorkingOn();
    const busy = Object.values(working).some(
      (entry) => typeof entry === "object" && entry !== null,
    );
    if (queued === 0 && !busy) return;
    await Bun.sleep(20);
  }
}

/**
 * Return the URL the web server actually bound to (with its resolved port).
 * Call after `api.start()` so the server has bound its port (tests use
 * `WEB_SERVER_PORT_TEST=0` for a random free port per file).
 *
 * The wildcard host is rewritten to loopback. Tests bind `0.0.0.0`, as deployed
 * services do, but `0.0.0.0` is an address to *listen* on, not one to connect
 * to, and handing it to `fetch` relies on the platform quietly substituting
 * loopback. Doing the substitution here means every suite fetches an address
 * that is actually meaningful.
 * @returns The bound base URL, or an empty string if the web server isn't running.
 */
export function serverUrl(): string {
  const web = api.servers.servers.find((s) => s.name === "web") as
    | WebServer
    | undefined;
  return (web?.url || "").replace("://0.0.0.0:", "://127.0.0.1:");
}

/**
 * Headers for a request that sends a JSON body: content type plus the session
 * cookie. Keryx reads sessions from a cookie, so this is how a test "is" a user.
 * @param sessionId - The session id to send.
 * @returns A headers object for `fetch()`.
 */
export function authHeaders(sessionId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Cookie: `${config.session.cookieName}=${sessionId}`,
  };
}

/**
 * Headers carrying only the session cookie, for GET requests with no body.
 * @param sessionId - The session id to send.
 * @returns A headers object for `fetch()`.
 */
export function cookieHeader(sessionId: string): Record<string, string> {
  return { Cookie: `${config.session.cookieName}=${sessionId}` };
}

/** Identity info for a seeded, signed-in test user (plus their own project). */
export interface TestUser {
  userId: number;
  sessionId: string;
  name: string;
  email: string;
  /** The project created for this user by the signup bootstrap; they are its admin. */
  projectId: number;
}

/** Password shared by every seeded test user. */
export const TEST_PASSWORD = "password123";

/**
 * Register a user over real HTTP and sign them in. Goes through `user:create` and
 * `session:create` rather than inserting rows, so the signup bootstrap (project +
 * membership + admin tag) is exercised by every suite that seeds a user.
 * @param url - The base server URL (from {@link serverUrl}).
 * @param name - Display name (at least 3 characters).
 * @param email - Email address (unique, case-insensitive).
 * @param password - Password (at least 8 characters).
 * @returns The user's id, session id, name, email, and bootstrap project id.
 * @throws {Error} If signup or sign-in does not return HTTP 200.
 */
export async function createUserAndLogin(
  url: string,
  name: string,
  email: string,
  password: string,
): Promise<TestUser> {
  const createRes = await fetch(`${url}/api/user`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const createData = (await createRes.json()) as ActionResponse<UserCreate>;
  if (createRes.status !== 200) {
    throw new Error(
      `Failed to create user ${email}: ${JSON.stringify(createData)}`,
    );
  }

  const loginRes = await fetch(`${url}/api/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginData = (await loginRes.json()) as ActionResponse<SessionCreate>;
  if (loginRes.status !== 200) {
    throw new Error(`Failed to log in ${email}: ${JSON.stringify(loginData)}`);
  }

  return {
    userId: createData.user.id,
    sessionId: loginData.session.id,
    name,
    email,
    projectId: createData.project.id,
  };
}

/**
 * Create a project tag as the given admin, over HTTP.
 * @param url - The base server URL.
 * @param admin - The admin creating the tag.
 * @param projectId - The project to create the tag in.
 * @param name - The tag name.
 * @returns The new tag's id.
 * @throws {Error} If `tag:create` does not return HTTP 200.
 */
export async function createTag(
  url: string,
  admin: TestUser,
  projectId: number,
  name: string,
): Promise<number> {
  const res = await fetch(`${url}/api/tag`, {
    method: "PUT",
    headers: authHeaders(admin.sessionId),
    body: JSON.stringify({ projectId, name }),
  });
  const data = (await res.json()) as ActionResponse<TagCreate>;
  if (res.status !== 200) {
    throw new Error(`Failed to create tag ${name}: ${JSON.stringify(data)}`);
  }
  return data.tag.id;
}

/**
 * Invite a user to a project as an admin and have them accept it, joining with the
 * given tags — through the **real** three-request flow (`invite:create` →
 * `invite:list-pending` → `invite:accept`), not direct inserts. That is deliberate:
 * the fixture that seeds every suite's team is also the thing that proves the
 * invite lifecycle still works end to end.
 * @param url - The base server URL.
 * @param admin - The admin issuing the invite.
 * @param projectId - The project to invite into.
 * @param invitee - The user being invited (already signed in).
 * @param tagIds - Tag ids to grant on acceptance.
 * @throws {Error} If any step of the flow fails.
 */
export async function inviteAndAccept(
  url: string,
  admin: TestUser,
  projectId: number,
  invitee: TestUser,
  tagIds: number[],
): Promise<void> {
  const createRes = await fetch(`${url}/api/invite`, {
    method: "PUT",
    headers: authHeaders(admin.sessionId),
    body: JSON.stringify({ projectId, inviteeEmail: invitee.email, tagIds }),
  });
  const createData = (await createRes.json()) as ActionResponse<InviteCreate>;
  if (createRes.status !== 200) {
    throw new Error(
      `Failed to invite ${invitee.email}: ${JSON.stringify(createData)}`,
    );
  }

  const pendingRes = await fetch(`${url}/api/invites/pending`, {
    headers: cookieHeader(invitee.sessionId),
  });
  const pending =
    (await pendingRes.json()) as ActionResponse<InviteListPending>;
  const invite = pending.invites.find((i) => i.projectId === projectId);
  if (!invite) {
    throw new Error(`No pending invite found for ${invitee.email}`);
  }

  const acceptRes = await fetch(`${url}/api/invite/accept`, {
    method: "POST",
    headers: authHeaders(invitee.sessionId),
    body: JSON.stringify({ inviteId: invite.id }),
  });
  if (acceptRes.status !== 200) {
    throw new Error(
      `Failed to accept invite for ${invitee.email}: ${JSON.stringify(
        await acceptRes.json(),
      )}`,
    );
  }
}

/**
 * The seeded test universe: a fixed named cast, so a test reads as a sentence
 * rather than as a setup script.
 *
 * Every user owns their own project (as its admin) from the signup bootstrap. On
 * top of that there is one canonical **shared project** — Peach's — that models a
 * real team: Peach administers it, Mario joined with `operators`, Luigi joined with
 * `viewers`, Toad is a member with no tags, and **Bowser is an outsider with no
 * membership at all**. That last one is what makes every RBAC permutation
 * coverable: outsider, plain member, tagged member, admin.
 */
export interface TestUniverse {
  url: string;
  mario: TestUser;
  luigi: TestUser;
  toad: TestUser;
  peach: TestUser;
  bowser: TestUser;
  /** Peach's project — the canonical shared project the others joined. */
  projectId: number;
  /** Tag ids created in the shared project. */
  tagIds: { operators: number; viewers: number };
}

/**
 * Truncate every table, retrying the deadlocks a concurrent teardown causes.
 *
 * `TRUNCATE … CASCADE` can deadlock against another file's `afterAll` when
 * `bun test` starts the next file while the previous one is still tearing
 * down. Retry the known Postgres deadlock (`40P01`) and lock-not-available
 * (`55P03`) codes so a green suite is not a function of scheduling.
 */
export async function retryClearDatabase(): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await api.db.clearDatabase();
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableClearDatabaseError(error)) {
        throw error;
      }
      await Bun.sleep(25 * attempt);
    }
  }
}

/**
 * Walk an error (and Drizzle's wrapped cause) for a retryable Postgres code.
 * @param error - Whatever `clearDatabase` threw.
 * @returns Whether the failure is a deadlock or lock timeout worth retrying.
 */
function isRetryableClearDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth++) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (code === "40P01" || code === "55P03") return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

/**
 * Start the server, clear the database, seed the cast, and assemble Peach's shared
 * project: two tags, plus Mario, Luigi, and Toad joined through real invite →
 * accept flows. Call from a suite's `beforeAll` with {@link HOOK_TIMEOUT}.
 * @returns The server URL, every seeded {@link TestUser}, the shared project id,
 *   and the shared tag ids.
 */
export async function buildTestUniverse(): Promise<TestUniverse> {
  await api.start();
  const url = serverUrl();
  await retryClearDatabase();

  const [mario, luigi, toad, peach, bowser] = await Promise.all([
    createUserAndLogin(url, "Mario", "mario@mushroom.kingdom", TEST_PASSWORD),
    createUserAndLogin(url, "Luigi", "luigi@mushroom.kingdom", TEST_PASSWORD),
    createUserAndLogin(url, "Toad", "toad@mushroom.kingdom", TEST_PASSWORD),
    createUserAndLogin(url, "Peach", "peach@mushroom.kingdom", TEST_PASSWORD),
    createUserAndLogin(url, "Bowser", "bowser@koopa.troop", TEST_PASSWORD),
  ]);

  const projectId = peach.projectId;
  const operators = await createTag(url, peach, projectId, "operators");
  const viewers = await createTag(url, peach, projectId, "viewers");

  await inviteAndAccept(url, peach, projectId, mario, [operators]);
  await inviteAndAccept(url, peach, projectId, luigi, [viewers]);
  // Toad joins with no tags — the "plain member" case.
  await inviteAndAccept(url, peach, projectId, toad, []);

  return {
    url,
    mario,
    luigi,
    toad,
    peach,
    bowser,
    projectId,
    tagIds: { operators, viewers },
  };
}

/**
 * A random string of unreserved characters, for PKCE verifiers and nonces.
 * @param length - How many characters to generate.
 * @returns The random string.
 */
export function randomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Compute the PKCE S256 code challenge (base64url SHA-256) for a verifier.
 * @param verifier - The PKCE code verifier.
 * @returns The base64url-encoded challenge.
 */
export async function computeS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Drive the full OAuth authorization-code + PKCE flow for an **existing** user and
 * return a Bearer access token for OAuth-protected MCP requests.
 *
 * Uses `mode: "login"`, which Keryx's authorize page routes to our
 * `isLoginAction` — so the token belongs to a seeded {@link TestUniverse} member,
 * carrying their memberships and tags. The MCP suites need this; it lives here
 * with the other fixtures because it is identity plumbing.
 * @param url - The base server URL (from {@link serverUrl}).
 * @param email - The existing user's email.
 * @param password - The existing user's password.
 * @returns A Bearer access token.
 * @throws {Error} If any step of the flow does not behave as expected.
 */
export async function getMcpAccessToken(
  url: string,
  email: string,
  password: string,
): Promise<string> {
  const redirectUri = "http://localhost:9999/callback";

  const regRes = await fetch(`${url}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "Botholomew MCP Test Client",
    }),
  });
  const { client_id: clientId } = (await regRes.json()) as {
    client_id: string;
  };

  const codeVerifier = randomString(43);
  const codeChallenge = await computeS256Challenge(codeVerifier);

  const authRes = await fetch(`${url}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      mode: "login",
      email,
      password,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      response_type: "code",
      state: "helper",
    }).toString(),
    redirect: "manual",
  });
  if (authRes.status !== 302) {
    throw new Error(
      `OAuth authorize did not redirect (status ${authRes.status}): ${await authRes.text()}`,
    );
  }
  const location = authRes.headers.get("location");
  if (!location) throw new Error("OAuth authorize returned no Location header");
  const code = new URL(location).searchParams.get("code");
  if (!code) {
    throw new Error(`OAuth authorize redirect carried no code: ${location}`);
  }

  const tokenRes = await fetch(`${url}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const { access_token: accessToken } = (await tokenRes.json()) as {
    access_token: string;
  };
  if (!accessToken) {
    throw new Error("OAuth token exchange returned no access_token");
  }
  return accessToken;
}

// ioredis can emit a late "Connection is closed." rejection during `api.stop()`
// teardown races; it is benign, so swallow only that specific case.
process.on("unhandledRejection", (reason: unknown) => {
  if (
    reason instanceof Error &&
    reason.message === "Connection is closed." &&
    reason.stack?.includes("ioredis")
  ) {
    return;
  }
  throw reason;
});
