import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { type ActionResponse } from "../../api";
import type { UserCreate, UserEdit } from "../../actions/user";
import { config } from "../../config";
import { logger } from "../../api";
import {
  initializeTestEnvironment,
  cleanupTestEnvironment,
  createUserViaAPI,
  createSession,
  USERS,
} from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await initializeTestEnvironment();
});

afterAll(async () => {
  await cleanupTestEnvironment();
});

describe("user:create", () => {
  test("user can be created", async () => {
    const response = await createUserViaAPI(USERS.MARIO);
    expect(response.user.id).toEqual(1);
    expect(response.user.email).toEqual("mario@example.com");
  });

  test("email must be unique", async () => {
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
    await createUserViaAPI(USERS.MARIO);

    // Create a session
    const sessionResponse = await createSession(USERS.MARIO);
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
});
