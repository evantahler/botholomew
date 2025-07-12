import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { users } from "../../models/user";
import { hashPassword } from "../../ops/UserOps";
import type { SessionCreate } from "../../actions/session";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await api.db.db.insert(users).values({
    name: "Test User",
    email: "test@example.com",
    password_hash: await hashPassword("password123"),
  });
});

afterAll(async () => {
  await api.stop();
});

describe("message:create", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agentId: number;

  beforeAll(async () => {
    await fetch(url + "/api/user", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Mario Mario",
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });

    const sessionRes = await fetch(url + "/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });
    const sessionResponse =
      (await sessionRes.json()) as ActionResponse<SessionCreate>;
    user = sessionResponse.user;
    session = sessionResponse.session;

    // Create an agent for testing messages
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        name: "Test Agent",
        description: "A test agent for messages",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const agentData = await agentResponse.json();
    agentId = agentData.agent.id;
  });

  test("should create a message successfully", async () => {
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId,
        role: "user",
        content: "Hello, how are you?",
      }),
    });

    const messageData = await messageResponse.json();
    expect(messageResponse.status).toBe(200);
    expect(messageData.message).toBeDefined();
    expect(messageData.message.agentId).toBe(agentId);
    expect(messageData.message.role).toBe("user");
    expect(messageData.message.content).toBe("Hello, how are you?");
    expect(messageData.message.createdAt).toBeDefined();
    expect(messageData.message.updatedAt).toBeDefined();
  });

  test("should create assistant message successfully", async () => {
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId,
        role: "assistant",
        content: "I'm doing well, thank you for asking!",
      }),
    });

    const messageData = await messageResponse.json();
    expect(messageResponse.status).toBe(200);
    expect(messageData.message.role).toBe("assistant");
    expect(messageData.message.content).toBe(
      "I'm doing well, thank you for asking!",
    );
  });

  test("should create system message successfully", async () => {
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId,
        role: "system",
        content: "You are a helpful AI assistant.",
      }),
    });

    const messageData = await messageResponse.json();
    expect(messageResponse.status).toBe(200);
    expect(messageData.message.role).toBe("system");
    expect(messageData.message.content).toBe("You are a helpful AI assistant.");
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId,
        role: "user",
        content: "Hello",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should validate required fields", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        role: "user",
        content: "Hello",
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should validate role enum", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId,
        role: "invalid_role",
        content: "Hello",
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should validate content length", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId,
        role: "user",
        content: "",
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should not allow creating message for non-existent agent", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId: 99999,
        role: "user",
        content: "Hello",
      }),
    });

    expect(response.status).toBe(500);
  });

  test("should not allow creating message for another user's agent", async () => {
    // Create another user and agent
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Other User",
        email: "other@example.com",
        password: "password123",
      }),
    });

    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "other@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();

    const otherAgentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        name: "Other Agent",
        description: "Another user's agent",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const otherAgentData = await otherAgentResponse.json();

    // Try to create message for other user's agent
    const response = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        agentId: otherAgentData.agent.id,
        role: "user",
        content: "Hello",
      }),
    });

    expect(response.status).toBe(500);
  });
});

describe("message:edit", () => {
  let createdMessage: any;
  let editUser: ActionResponse<SessionCreate>["user"];
  let editSession: ActionResponse<SessionCreate>["session"];
  let editAgentId: number;

  beforeAll(async () => {
    // Get the user and session for editing
    const sessionRes = await fetch(url + "/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });
    const sessionResponse =
      (await sessionRes.json()) as ActionResponse<SessionCreate>;
    editUser = sessionResponse.user;
    editSession = sessionResponse.session;

    // Create an agent for editing messages
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        name: "Edit Agent",
        description: "Agent for editing messages",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const agentData = await agentResponse.json();
    editAgentId = agentData.agent.id;

    // Create a message to edit
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        agentId: editAgentId,
        role: "user",
        content: "Original content",
      }),
    });
    const messageData = await messageResponse.json();
    createdMessage = messageData.message;
  });

  test("should edit a message successfully", async () => {
    const editResponse = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        id: createdMessage.id,
        content: "Updated content",
      }),
    });

    const editData = await editResponse.json();
    expect(editResponse.status).toBe(200);
    expect(editData.message).toBeDefined();
    expect(editData.message.content).toBe("Updated content");
    expect(editData.message.id).toBe(createdMessage.id);
    expect(editData.message.agentId).toBe(editAgentId);
  });

  test("should edit message role successfully", async () => {
    const editResponse = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        id: createdMessage.id,
        role: "assistant",
      }),
    });

    const editData = await editResponse.json();
    expect(editResponse.status).toBe(200);
    expect(editData.message.role).toBe("assistant");
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: createdMessage.id,
        content: "Updated content",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should validate required message id", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        content: "Updated content",
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should not allow editing another user's message", async () => {
    // Create another user and agent
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Edit Other User",
        email: "editother@example.com",
        password: "password123",
      }),
    });

    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "editother@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();

    // Try to edit the first user's message with the second user's session
    const response = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        id: createdMessage.id,
        content: "Hacked content",
      }),
    });

    expect(response.status).toBe(500);
  });
});

describe("message:delete", () => {
  let createdMessage: any;
  let deleteUser: ActionResponse<SessionCreate>["user"];
  let deleteSession: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    // Get the user and session for deleting
    const sessionRes = await fetch(url + "/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });
    const sessionResponse =
      (await sessionRes.json()) as ActionResponse<SessionCreate>;
    deleteUser = sessionResponse.user;
    deleteSession = sessionResponse.session;

    // Create an agent for deleting messages
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({
        name: "Delete Agent",
        description: "Agent for deleting messages",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const agentData = await agentResponse.json();

    // Create a message to delete
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({
        agentId: agentData.agent.id,
        role: "user",
        content: "Message to delete",
      }),
    });
    const messageData = await messageResponse.json();
    createdMessage = messageData.message;
  });

  test("should delete a message successfully", async () => {
    const deleteResponse = await fetch(`${url}/api/message`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({ id: createdMessage.id }),
    });
    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Try to edit the deleted message (should fail)
    const editResponse = await fetch(`${url}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({ id: createdMessage.id, content: "Should Fail" }),
    });
    expect(editResponse.status).toBe(500);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/message`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: createdMessage.id }),
    });
    expect(response.status).toBe(401);
  });

  test("should not allow deleting another user's message", async () => {
    // Create another user and session
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Delete Other User",
        email: "deleteother@example.com",
        password: "password123",
      }),
    });
    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "deleteother@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();

    // Try to delete the first user's message with the second user's session
    const response = await fetch(`${url}/api/message`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({ id: createdMessage.id }),
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
  });
});

describe("message:view", () => {
  let createdMessage: any;
  let viewUser: ActionResponse<SessionCreate>["user"];
  let viewSession: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    // Get the user and session for viewing
    const sessionRes = await fetch(url + "/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });
    const sessionResponse =
      (await sessionRes.json()) as ActionResponse<SessionCreate>;
    viewUser = sessionResponse.user;
    viewSession = sessionResponse.session;

    // Create an agent for viewing messages
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
      body: JSON.stringify({
        name: "View Agent",
        description: "Agent for viewing messages",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const agentData = await agentResponse.json();

    // Create a message to view
    const messageResponse = await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
      body: JSON.stringify({
        agentId: agentData.agent.id,
        role: "user",
        content: "Message to view",
      }),
    });
    const messageData = await messageResponse.json();
    createdMessage = messageData.message;
  });

  test("should view a message successfully", async () => {
    const viewResponse = await fetch(
      `${url}/api/message?id=${createdMessage.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${viewSession.cookieName}=${viewSession.id}`,
        },
      },
    );
    const viewData = await viewResponse.json();
    expect(viewResponse.status).toBe(200);
    expect(viewData.message).toBeDefined();
    expect(viewData.message.id).toBe(createdMessage.id);
    expect(viewData.message.role).toBe("user");
    expect(viewData.message.content).toBe("Message to view");
    expect(viewData.message.createdAt).toBeDefined();
    expect(viewData.message.updatedAt).toBeDefined();
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/message?id=${createdMessage.id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(401);
  });

  test("should not allow viewing another user's message", async () => {
    // Create another user and session
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "View Other User",
        email: "viewother@example.com",
        password: "password123",
      }),
    });
    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "viewother@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();

    // Try to view the first user's message with the second user's session
    const response = await fetch(`${url}/api/message?id=${createdMessage.id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
    });
    expect(response.status).toBe(500);
  });

  test("should return not found for non-existent message", async () => {
    const response = await fetch(`${url}/api/message?id=999999`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
    });
    expect(response.status).toBe(500);
  });
});

describe("message:list", () => {
  let listUser: ActionResponse<SessionCreate>["user"];
  let listSession: ActionResponse<SessionCreate>["session"];
  let listAgentId: number;
  let messageIds: number[] = [];

  beforeAll(async () => {
    // Get the user and session for listing
    const sessionRes = await fetch(url + "/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mario@example.com",
        password: "mushroom1",
      }),
    });
    const sessionResponse =
      (await sessionRes.json()) as ActionResponse<SessionCreate>;
    listUser = sessionResponse.user;
    listSession = sessionResponse.session;

    // Create an agent for listing messages
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${listSession.cookieName}=${listSession.id}`,
      },
      body: JSON.stringify({
        name: "List Agent",
        description: "Agent for listing messages",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const agentData = await agentResponse.json();
    listAgentId = agentData.agent.id;

    // Create 5 messages for this agent
    for (let i = 0; i < 5; i++) {
      const messageResponse = await fetch(`${url}/api/message`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${listSession.cookieName}=${listSession.id}`,
        },
        body: JSON.stringify({
          agentId: listAgentId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        }),
      });
      const messageData = await messageResponse.json();
      messageIds.push(messageData.message.id);
    }

    // Create another agent and messages for another user
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "List Other User",
        email: "listother@example.com",
        password: "password123",
      }),
    });
    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "listother@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();
    const otherAgentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        name: "Other User Agent",
        description: "Another user's agent",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const otherAgentData = await otherAgentResponse.json();
    await fetch(`${url}/api/message`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        agentId: otherAgentData.agent.id,
        role: "user",
        content: "Other user message",
      }),
    });
  });

  test("should list all messages for an agent", async () => {
    const res = await fetch(`${url}/api/messages?agentId=${listAgentId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${listSession.cookieName}=${listSession.id}`,
      },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBeGreaterThanOrEqual(5);
    for (const message of data.messages) {
      expect(message.agentId).toBe(listAgentId);
    }
  });

  test("should support limit and offset", async () => {
    const res = await fetch(
      `${url}/api/messages?agentId=${listAgentId}&limit=2&offset=1`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${listSession.cookieName}=${listSession.id}`,
        },
      },
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBeLessThanOrEqual(2);
    for (const message of data.messages) {
      expect(message.agentId).toBe(listAgentId);
    }
  });

  test("should require authentication", async () => {
    const res = await fetch(`${url}/api/messages?agentId=${listAgentId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  test("should require agentId parameter", async () => {
    const res = await fetch(`${url}/api/messages`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${listSession.cookieName}=${listSession.id}`,
      },
    });
    expect(res.status).toBe(406);
  });

  test("should not allow listing messages for another user's agent", async () => {
    // Create another user and agent
    await fetch(`${url}/api/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "List Other User 2",
        email: "listother2@example.com",
        password: "password123",
      }),
    });
    const otherSessionRes = await fetch(`${url}/api/session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "listother2@example.com",
        password: "password123",
      }),
    });
    const otherSessionData = await otherSessionRes.json();
    const otherAgentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        name: "Other User Agent 2",
        description: "Another user's agent",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });
    const otherAgentData = await otherAgentResponse.json();

    // Try to list messages for other user's agent
    const res = await fetch(
      `${url}/api/messages?agentId=${otherAgentData.agent.id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${listSession.cookieName}=${listSession.id}`,
        },
      },
    );
    expect(res.status).toBe(500);
  });
});
