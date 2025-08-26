import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import type {
  ToolkitAuthorizationCreate,
  ToolkitAuthorizationDelete,
  ToolkitAuthorizationList,
} from "../../actions/toolkit_authorization";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { toolkit_authorizations } from "../../models/toolkit_authorization";
import { createUserAndSession, USERS } from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

// Mock the Arcade client
const mockArcadeClient = {
  tools: {
    list: mock(() =>
      Promise.resolve({
        items: [
          {
            toolkit: { name: "github", description: "GitHub toolkit" },
            name: "github_tool",
            requirements: {
              authorization: {
                provider_id: "github_provider",
                oauth2: { scopes: ["repo", "user"] },
              },
            },
          },
        ],
      }),
    ),
  },
  auth: {
    start: mock(() => Promise.resolve({ status: "completed" })),
  },
};

beforeAll(async () => {
  await api.start();

  // Mock the arcade client after API initialization
  api.arcade = {
    client: mockArcadeClient as any,
    loadArcadeToolsForAgent: mock(() => Promise.resolve([])),
    getAvailableToolkits: mock(() =>
      Promise.resolve([
        {
          name: "github",
          description: "GitHub toolkit",
          tools: ["github_tool"],
        },
      ]),
    ),
    authorizeToolkitForUser: mock(() => Promise.resolve(undefined)), // Mock to return undefined (no auth URL needed)
  };

  await api.db.clearDatabase();
});

afterEach(async () => {
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

describe("toolkit_authorization:list", () => {
  test("it fails without a session", async () => {
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  test("it returns empty list for user with no authorizations", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "GET",
      headers: {
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
    });

    expect(res.status).toBe(200);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationList>;
    expect(response.toolkitAuthorizations).toEqual([]);
  });

  test("it returns user's authorized toolkits", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    // Create some authorizations directly in the database
    await api.db.db.insert(toolkit_authorizations).values([
      { userId: session.user.id, toolkitName: "github" },
      { userId: session.user.id, toolkitName: "slack" },
    ]);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "GET",
      headers: {
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
    });

    expect(res.status).toBe(200);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationList>;
    expect(response.toolkitAuthorizations).toHaveLength(2);
    expect(response.toolkitAuthorizations.map((a) => a.toolkitName)).toContain(
      "github",
    );
    expect(response.toolkitAuthorizations.map((a) => a.toolkitName)).toContain(
      "slack",
    );
  });

  test("it only returns current user's authorizations", async () => {
    const marioSession = await createUserAndSession(USERS.MARIO);
    const luigiSession = await createUserAndSession(USERS.LUIGI);

    // Create authorizations for both users
    await api.db.db.insert(toolkit_authorizations).values([
      { userId: marioSession.user.id, toolkitName: "github" },
      { userId: luigiSession.user.id, toolkitName: "slack" },
    ]);

    // Check Mario's authorizations
    const marioRes = await fetch(url + "/api/toolkit-authorizations", {
      method: "GET",
      headers: {
        Cookie: `${marioSession.session.cookieName}=${marioSession.session.id}`,
      },
    });

    const marioResponse =
      (await marioRes.json()) as ActionResponse<ToolkitAuthorizationList>;
    expect(marioResponse.toolkitAuthorizations).toHaveLength(1);
    expect(marioResponse.toolkitAuthorizations[0].toolkitName).toBe("github");

    // Check Luigi's authorizations
    const luigiRes = await fetch(url + "/api/toolkit-authorizations", {
      method: "GET",
      headers: {
        Cookie: `${luigiSession.session.cookieName}=${luigiSession.session.id}`,
      },
    });

    const luigiResponse =
      (await luigiRes.json()) as ActionResponse<ToolkitAuthorizationList>;
    expect(luigiResponse.toolkitAuthorizations).toHaveLength(1);
    expect(luigiResponse.toolkitAuthorizations[0].toolkitName).toBe("slack");
  });
});

describe("toolkit_authorization:create", () => {
  test("it fails without a session", async () => {
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitName: "github" }),
    });
    expect(res.status).toBe(401);
  });

  test("it creates a new toolkit authorization", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });

    expect(res.status).toBe(200);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationCreate>;
    expect(response.toolkitAuthorization.toolkitName).toBe("github");
    expect(response.toolkitAuthorization.userId).toBe(session.user.id);
    expect(response.toolkitAuthorization.id).toBeDefined();
    expect(response.toolkitAuthorization.createdAt).toBeDefined();
    expect(response.toolkitAuthorization.updatedAt).toBeDefined();
  });

  test("it prevents duplicate authorizations for the same user", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    // Create first authorization
    await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });

    // Try to create duplicate
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });

    expect(res.status).toBe(406);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationCreate>;
    expect(response.error?.message).toMatch(/already authorized/);
  });

  test("it allows different users to authorize the same toolkit", async () => {
    const marioSession = await createUserAndSession(USERS.MARIO);
    const luigiSession = await createUserAndSession(USERS.LUIGI);

    // Mario authorizes github
    const marioRes = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${marioSession.session.cookieName}=${marioSession.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });
    expect(marioRes.status).toBe(200);

    // Luigi authorizes github (should work)
    const luigiRes = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${luigiSession.session.cookieName}=${luigiSession.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });
    expect(luigiRes.status).toBe(200);

    // Verify both exist
    const marioAuths = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, marioSession.user.id));

    const luigiAuths = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, luigiSession.user.id));

    expect(marioAuths).toHaveLength(1);
    expect(luigiAuths).toHaveLength(1);
    expect(marioAuths[0].toolkitName).toBe("github");
    expect(luigiAuths[0].toolkitName).toBe("github");
  });

  test("validation failures return proper error", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitName: "" }),
    });

    expect(res.status).toBe(406);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationCreate>;
    expect(response.error?.message.toLowerCase()).toMatch(/required/);
  });
});

describe("toolkit_authorization:delete", () => {
  test("it fails without a session", async () => {
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitName: "github" }),
    });
    expect(res.status).toBe(401);
  });

  test("it deletes an existing toolkit authorization", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    // Create authorization first
    await api.db.db.insert(toolkit_authorizations).values({
      userId: session.user.id,
      toolkitName: "github",
    });

    // Delete it
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });

    expect(res.status).toBe(200);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationDelete>;
    expect(response.toolkitAuthorization).toBeDefined();

    // Verify it's gone from database
    const remainingAuths = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, session.user.id));

    expect(remainingAuths).toHaveLength(0);
  });

  test("it fails when trying to delete non-existent authorization", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.session.cookieName}=${session.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "nonexistent" }),
    });

    expect(res.status).toBe(406);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationDelete>;
    expect(response.error?.message).toMatch(/not found/);
  });

  test("it only deletes the current user's authorization", async () => {
    const marioSession = await createUserAndSession(USERS.MARIO);
    const luigiSession = await createUserAndSession(USERS.LUIGI);

    // Create authorizations for both users
    await api.db.db.insert(toolkit_authorizations).values([
      { userId: marioSession.user.id, toolkitName: "github" },
      { userId: luigiSession.user.id, toolkitName: "github" },
    ]);

    // Mario deletes his authorization
    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${marioSession.session.cookieName}=${marioSession.session.id}`,
      },
      body: JSON.stringify({ toolkitName: "github" }),
    });

    expect(res.status).toBe(200);

    // Verify Mario's is gone but Luigi's remains
    const marioAuths = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, marioSession.user.id));

    const luigiAuths = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(eq(toolkit_authorizations.userId, luigiSession.user.id));

    expect(marioAuths).toHaveLength(0);
    expect(luigiAuths).toHaveLength(1);
    expect(luigiAuths[0].toolkitName).toBe("github");
  });

  test("validation failures return proper error", async () => {
    const session = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/toolkit-authorizations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitName: "" }),
    });

    expect(res.status).toBe(406);
    const response =
      (await res.json()) as ActionResponse<ToolkitAuthorizationDelete>;
    expect(response.error?.message.toLowerCase()).toMatch(/required/);
  });
});
