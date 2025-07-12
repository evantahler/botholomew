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

describe("agent:create", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];

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
  });

  test("should create an agent successfully", async () => {
    // Use the session cookie from beforeAll
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        name: "Test Agent",
        description: "A test agent",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });

    const agentData = await agentResponse.json();
    expect(agentResponse.status).toBe(200);
    expect(agentData.agent).toBeDefined();
    expect(agentData.agent.name).toBe("Test Agent");
    expect(agentData.agent.description).toBe("A test agent");
    expect(agentData.agent.model).toBe("gpt-4");
    expect(agentData.agent.systemPrompt).toBe("You are a helpful assistant.");
    expect(agentData.agent.enabled).toBe(true);
    expect(agentData.agent.userId).toBe(user.id);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Agent",
        description: "A test agent",
        model: "gpt-4",
        systemPrompt: "You are a helpful assistant.",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should validate required fields", async () => {
    // Use the session cookie from beforeAll
    const response = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        description: "A test agent",
      }),
    });

    expect(response.status).toBe(406);
  });
});

describe("agent:edit", () => {
  let createdAgent: any;
  let editUser: ActionResponse<SessionCreate>["user"];
  let editSession: ActionResponse<SessionCreate>["session"];

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

    // Create an agent to edit
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        name: "Original Agent",
        description: "Original description",
        model: "gpt-3.5-turbo",
        systemPrompt: "Original system prompt",
        enabled: false,
      }),
    });
    const agentData = await agentResponse.json();
    createdAgent = agentData.agent;
  });

  test("should edit an agent successfully", async () => {
    const editResponse = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        id: createdAgent.id,
        name: "Updated Agent",
        description: "Updated description",
        model: "gpt-4",
        systemPrompt: "Updated system prompt",
        enabled: true,
      }),
    });

    const editData = await editResponse.json();
    expect(editResponse.status).toBe(200);
    expect(editData.agent).toBeDefined();
    expect(editData.agent.name).toBe("Updated Agent");
    expect(editData.agent.description).toBe("Updated description");
    expect(editData.agent.model).toBe("gpt-4");
    expect(editData.agent.systemPrompt).toBe("Updated system prompt");
    expect(editData.agent.enabled).toBe(true);
    expect(editData.agent.id).toBe(createdAgent.id);
    expect(editData.agent.userId).toBe(editUser.id);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: createdAgent.id,
        name: "Updated Agent",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should validate required agent id", async () => {
    const response = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${editSession.cookieName}=${editSession.id}`,
      },
      body: JSON.stringify({
        name: "Updated Agent",
      }),
    });

    expect(response.status).toBe(406);
  });

  test("should not allow editing other user's agent", async () => {
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

    // Try to edit the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        id: createdAgent.id,
        name: "Hacked Agent",
      }),
    });

    expect(response.status).toBe(500);
  });
});

describe("agent:delete", () => {
  let createdAgent: any;
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

    // Create an agent to delete
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({
        name: "Delete Agent",
        description: "To be deleted",
        model: "gpt-3.5-turbo",
        systemPrompt: "Delete me",
        enabled: false,
      }),
    });
    const agentData = await agentResponse.json();
    createdAgent = agentData.agent;
  });

  test("should delete an agent successfully", async () => {
    const deleteResponse = await fetch(`${url}/api/agent`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({ id: createdAgent.id }),
    });
    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Try to edit the deleted agent (should fail)
    const editResponse = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${deleteSession.cookieName}=${deleteSession.id}`,
      },
      body: JSON.stringify({ id: createdAgent.id, name: "Should Fail" }),
    });
    expect(editResponse.status).toBe(500);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: createdAgent.id }),
    });
    expect(response.status).toBe(401);
  });

  test("should not allow deleting another user's agent", async () => {
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

    // Try to delete the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({ id: createdAgent.id }),
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
  });
});

describe("agent:view", () => {
  let createdAgent: any;
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

    // Create an agent to view
    const agentResponse = await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
      body: JSON.stringify({
        name: "View Agent",
        description: "To be viewed",
        model: "gpt-3.5-turbo",
        systemPrompt: "View me",
        enabled: false,
      }),
    });
    const agentData = await agentResponse.json();
    createdAgent = agentData.agent;
  });

  test("should view an agent successfully", async () => {
    const viewResponse = await fetch(`${url}/api/agent?id=${createdAgent.id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
    });
    const viewData = await viewResponse.json();
    expect(viewResponse.status).toBe(200);
    expect(viewData.agent).toBeDefined();
    expect(viewData.agent.id).toBe(createdAgent.id);
    expect(viewData.agent.userId).toBe(viewUser.id);
    expect(viewData.agent.name).toBe("View Agent");
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent?id=${createdAgent.id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(401);
  });

  test("should not allow viewing another user's agent", async () => {
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

    // Try to view the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent?id=${createdAgent.id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
    });
    expect(response.status).toBe(500);
  });

  test("should return not found for non-existent agent", async () => {
    const response = await fetch(`${url}/api/agent?id=999999`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${viewSession.cookieName}=${viewSession.id}`,
      },
    });
    expect(response.status).toBe(500);
  });
});

describe("agent:list", () => {
  let listUser: ActionResponse<SessionCreate>["user"];
  let listSession: ActionResponse<SessionCreate>["session"];
  let agentIds: number[] = [];

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

    // Create 5 agents for this user
    for (let i = 0; i < 5; i++) {
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${listSession.cookieName}=${listSession.id}`,
        },
        body: JSON.stringify({
          name: `List Agent ${i}`,
          description: `Agent ${i}`,
          model: "gpt-3.5-turbo",
          systemPrompt: `Agent ${i} system prompt`,
          enabled: false,
        }),
      });
      const agentData = await agentResponse.json();
      agentIds.push(agentData.agent.id);
    }
    // Create an agent for another user
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
    await fetch(`${url}/api/agent`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSessionData.session.cookieName}=${otherSessionData.session.id}`,
      },
      body: JSON.stringify({
        name: "Other User Agent",
        description: "Should not be listed",
        model: "gpt-3.5-turbo",
        systemPrompt: "Other user system prompt",
        enabled: false,
      }),
    });
  });

  test("should list all own agents", async () => {
    const res = await fetch(`${url}/api/agents`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${listSession.cookieName}=${listSession.id}`,
      },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThanOrEqual(5);
    for (const agent of data.agents) {
      expect(agent.userId).toBe(listUser.id);
    }
  });

  test("should support limit and offset", async () => {
    const res = await fetch(`${url}/api/agents?limit=2&offset=1`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${listSession.cookieName}=${listSession.id}`,
      },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeLessThanOrEqual(2);
    for (const agent of data.agents) {
      expect(agent.userId).toBe(listUser.id);
    }
  });

  test("should require authentication", async () => {
    const res = await fetch(`${url}/api/agents`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});
