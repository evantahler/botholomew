import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { eq } from "drizzle-orm";
import { api, type ActionResponse } from "../../api";
import type { UserCreate, UserEdit, UserView } from "../../actions/user";
import { config } from "../../config";
import { logger } from "../../api";
import {
  createUserViaAPI,
  createSession,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";
import { users } from "../../models/user";
import { ErrorType } from "../../classes/TypedError";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
});

afterEach(async () => {
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

describe("user:create", () => {
  test("user can be created", async () => {
    const response = await createUserViaAPI(USERS.MARIO);
    expect(response.user.id).toEqual(1);
    expect(response.user.email).toEqual("mario@example.com");
  });

  test("user can be created with metadata", async () => {
    const userWithMetadata = {
      ...USERS.MARIO,
      metadata: "**Favorite Color:** Red\n**Slack Username:** @mario",
    };

    const res = await fetch(url + "/api/user", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userWithMetadata),
    });
    const response = (await res.json()) as ActionResponse<UserCreate>;
    expect(res.status).toBe(200);
    expect(response.user.metadata).toEqual(userWithMetadata.metadata);
  });

  test("email must be unique", async () => {
    await createUserViaAPI(USERS.MARIO);

    const response = await createUserViaAPI(USERS.MARIO);
    expect(response.error?.message.toLowerCase()).toMatch(
      /user already exists/,
    );
  });

  test("validation failures return the proper key", async () => {
    const res = await fetch(url + "/api/user", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x",
        email: "y",
        password: "z",
      }),
    });
    const response = (await res.json()) as ActionResponse<UserCreate>;
    expect(res.status).toBe(406);
    expect(response.error?.message.toLowerCase()).toMatch(
      /this field is required and must be at least 3 characters long/,
    );
    expect(response.error?.key).toEqual("name");
    expect(response.error?.value).toEqual("x");
  });

  test("secret fields are redacted in logs", async () => {
    // Mock the logger to capture log messages
    const originalInfo = logger.info;
    const logMessages: string[] = [];
    logger.info = (message: string) => {
      logMessages.push(message);
    };

    try {
      const formData = new FormData();
      formData.append("name", "Test User");
      formData.append("email", "test@example.com");
      formData.append("password", "secretpassword123");

      const res = await fetch(url + "/api/user", {
        method: "PUT",
        body: formData,
      });

      // Find the log message that contains the action execution
      const actionLogMessage = logMessages.find(
        (msg) => msg.includes("[ACTION:") && msg.includes("user:create"),
      );

      expect(actionLogMessage).toBeDefined();
      expect(actionLogMessage).toContain('"name":"Test User"');
      expect(actionLogMessage).toContain('"email":"test@example.com"');
      expect(actionLogMessage).toContain('"password":"[[secret]]"');
      expect(actionLogMessage).not.toContain('"password":"secretpassword123"');
    } finally {
      // Restore original logger
      logger.info = originalInfo;
    }
  });
});

describe("user:view", () => {
  test("it fails without a session", async () => {
    const res = await fetch(url + "/api/user", {
      method: "GET",
    });
    const response = (await res.json()) as ActionResponse<UserView>;
    expect(res.status).toBe(401);
    expect(response.error?.message).toMatch(/Session not found/);
  });

  test("it returns the user when session is valid", async () => {
    // First create a user and session
    const sessionResponse = await createUserAndSession(USERS.MARIO);

    const res = await fetch(url + "/api/user", {
      method: "GET",
      headers: {
        Cookie: `${config.session.cookieName}=${sessionResponse.session.id}`,
      },
    });
    const response = (await res.json()) as ActionResponse<UserView>;
    expect(res.status).toBe(200);
    expect(response.user.id).toEqual(sessionResponse.user.id);
    expect(response.user.name).toEqual("Mario Mario");
    expect(response.user.email).toEqual("mario@example.com");
  });

  test("it returns the user with metadata when session is valid", async () => {
    // First create a user with metadata and session
    const userWithMetadata = {
      ...USERS.MARIO,
      metadata: "**Favorite Color:** Green\n**Team:** Engineering",
    };

    // Create user directly first
    const createRes = await fetch(url + "/api/user", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userWithMetadata),
    });
    expect(createRes.status).toBe(200);

    // Then create session
    const sessionResponse = await createSession(userWithMetadata);

    const res = await fetch(url + "/api/user", {
      method: "GET",
      headers: {
        Cookie: `${config.session.cookieName}=${sessionResponse.session.id}`,
      },
    });
    const response = (await res.json()) as ActionResponse<UserView>;
    expect(res.status).toBe(200);
    expect(response.user.id).toEqual(sessionResponse.user.id);
    expect(response.user.name).toEqual("Mario Mario");
    expect(response.user.email).toEqual("mario@example.com");
    expect(response.user.metadata).toEqual(userWithMetadata.metadata);
  });

  test("it fails when user is not found", async () => {
    // Create a user and session
    const sessionResponse = await createUserAndSession(USERS.MARIO);

    // Delete the user from the database directly
    await api.db.db.delete(users).where(eq(users.id, sessionResponse.user.id));

    // Try to view the user with the existing session
    const res = await fetch(url + "/api/user", {
      method: "GET",
      headers: {
        Cookie: `${config.session.cookieName}=${sessionResponse.session.id}`,
      },
    });
    const response = (await res.json()) as ActionResponse<UserView>;
    expect(res.status).toBe(500);
    expect(response.error?.message).toEqual("User not found");
    expect(response.error?.type).toEqual(ErrorType.CONNECTION_ACTION_RUN);
  });
});

describe("user:edit", () => {
  test("it fails without a session", async () => {
    const res = await fetch(url + "/api/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new name" }),
    });
    const response = (await res.json()) as ActionResponse<UserEdit>;
    expect(res.status).toBe(401);
    expect(response.error?.message).toMatch(/Session not found/);
  });

  test("the user can be updated", async () => {
    // First create a user
    const uniqueUser = { ...USERS.MARIO };
    await createUserViaAPI(uniqueUser);

    // Create a session
    const sessionResponse = await createSession(uniqueUser);
    const sessionId = sessionResponse.session.id;

    const res = await fetch(url + "/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${config.session.cookieName}=${sessionId}`,
      },
      body: JSON.stringify({ name: "new name" }),
    });
    const response = (await res.json()) as ActionResponse<UserEdit>;
    expect(res.status).toBe(200);
    expect(response.user.name).toEqual("new name");
    expect(response.user.email).toEqual("mario@example.com");
    expect(sessionResponse.user.updatedAt).toBeLessThan(
      response.user.updatedAt,
    );
  });

  test("metadata can be updated and retrieved", async () => {
    // First create a user
    const uniqueUser = { ...USERS.MARIO, name: "Mario Metadata Update" };
    await createUserViaAPI(uniqueUser);

    // Create a session
    const sessionResponse = await createSession(uniqueUser);
    const sessionId = sessionResponse.session.id;

    const testMetadata =
      "**Favorite Color:** Blue\n**Slack Username:** @mario\n**Team:** Platform";

    // Update the user's metadata
    const res = await fetch(url + "/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${config.session.cookieName}=${sessionId}`,
      },
      body: JSON.stringify({ metadata: testMetadata }),
    });
    const response = (await res.json()) as ActionResponse<UserEdit>;
    expect(res.status).toBe(200);
    expect(response.user.metadata).toEqual(testMetadata);

    // Verify the metadata is persisted by viewing the user again
    const viewRes = await fetch(url + "/api/user", {
      method: "GET",
      headers: {
        Cookie: `${config.session.cookieName}=${sessionId}`,
      },
    });
    const viewResponse = (await viewRes.json()) as ActionResponse<UserView>;
    expect(viewRes.status).toBe(200);
    expect(viewResponse.user.metadata).toEqual(testMetadata);
  });

  test("metadata can be updated to empty string", async () => {
    // First create a user with some metadata
    const uniqueUser = { ...USERS.MARIO };
    await createUserViaAPI(uniqueUser);
    const sessionResponse = await createSession(uniqueUser);
    const sessionId = sessionResponse.session.id;

    // Set initial metadata
    await fetch(url + "/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${config.session.cookieName}=${sessionId}`,
      },
      body: JSON.stringify({ metadata: "Some initial metadata" }),
    });

    // Update metadata to empty string
    const res = await fetch(url + "/api/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${config.session.cookieName}=${sessionId}`,
      },
      body: JSON.stringify({ metadata: "" }),
    });
    const response = (await res.json()) as ActionResponse<UserEdit>;
    expect(res.status).toBe(200);
    expect(response.user.metadata).toEqual("");
  });
});
