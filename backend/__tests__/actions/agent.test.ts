import { test, describe, expect, beforeAll, afterAll, mock } from "bun:test";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import type { SessionCreate } from "../../actions/session";
import {
  createTestUser,
  createUserAndSession,
  createAgent,
  USERS,
  TEST_AGENTS,
} from "../utils/testHelpers";
import { AgentCreate } from "../../actions/agent";

// Mock the OpenAI agents module
const mockRun = mock(() =>
  Promise.resolve({ finalOutput: "Mocked assistant response" }),
);
const mockAgent = mock(() => ({}));

mock.module("@openai/agents", () => ({
  Agent: mockAgent,
  run: mockRun,
}));

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await createTestUser(USERS.LUIGI);
});

afterAll(async () => {
  await api.stop();
});

describe("agent:models", () => {
  test("should return available agent models", async () => {
    const response = await fetch(`${url}/api/agent/models`, {
      method: "GET",
      credentials: "include",
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.models).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);

    // Check that each model has the expected structure
    data.models.forEach((model: any) => {
      expect(model).toHaveProperty("value");
      expect(model).toHaveProperty("label");
      expect(typeof model.value).toBe("string");
      expect(typeof model.label).toBe("string");
    });

    // Check that expected models are included
    const modelValues = data.models.map((m: any) => m.value);
    expect(modelValues).toContain("gpt-4o");
    expect(modelValues).toContain("gpt-3.5-turbo");
  });
});

describe("agent:create", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
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
        model: "gpt-4o",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      }),
    });

    const agentData = await agentResponse.json();
    expect(agentResponse.status).toBe(200);
    expect(agentData.agent).toBeDefined();
    expect(agentData.agent.name).toBe("Test Agent");
    expect(agentData.agent.description).toBe("A test agent");
    expect(agentData.agent.model).toBe("gpt-4o");
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
        model: "gpt-4o",
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
  let createdAgent: ActionResponse<AgentCreate>["agent"];
  let editUser: ActionResponse<SessionCreate>["user"];
  let editSession: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    // Get the user and session for editing
    const testSession = await createUserAndSession(USERS.MARIO);
    editUser = testSession.user;
    editSession = testSession.session;

    // Create an agent to edit
    createdAgent = await createAgent(
      { user: editUser, session: editSession },
      TEST_AGENTS.EDITABLE,
    );
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
        model: "gpt-4o",
        systemPrompt: "Updated system prompt",
        enabled: true,
      }),
    });

    const editData = await editResponse.json();
    expect(editResponse.status).toBe(200);
    expect(editData.agent).toBeDefined();
    expect(editData.agent.name).toBe("Updated Agent");
    expect(editData.agent.description).toBe("Updated description");
    expect(editData.agent.model).toBe("gpt-4o");
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

  test("should not allow editing another user's agent", async () => {
    // Create another user and agent
    const otherUser = {
      name: "Edit Other User",
      email: "editother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);
    const otherAgent = await createAgent(otherSession, TEST_AGENTS.BASIC);

    // Try to edit the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
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
  let createdAgent: ActionResponse<AgentCreate>["agent"];
  let deleteUser: ActionResponse<SessionCreate>["user"];
  let deleteSession: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    // Get the user and session for deleting
    const testSession = await createUserAndSession(USERS.MARIO);
    deleteUser = testSession.user;
    deleteSession = testSession.session;

    // Create an agent to delete
    createdAgent = await createAgent(
      { user: deleteUser, session: deleteSession },
      {
        name: "Delete Agent",
        description: "To be deleted",
        model: "gpt-3.5-turbo",
        systemPrompt: "Delete me",
        enabled: false,
      },
    );
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
    const otherUser = {
      name: "Delete Other User",
      email: "deleteother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Try to delete the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
      body: JSON.stringify({ id: createdAgent.id }),
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
  });
});

describe("agent:view", () => {
  let createdAgent: ActionResponse<AgentCreate>["agent"];
  let viewUser: ActionResponse<SessionCreate>["user"];
  let viewSession: ActionResponse<SessionCreate>["session"];

  beforeAll(async () => {
    // Get the user and session for viewing
    const testSession = await createUserAndSession(USERS.MARIO);
    viewUser = testSession.user;
    viewSession = testSession.session;

    // Create an agent to view
    createdAgent = await createAgent(
      { user: viewUser, session: viewSession },
      {
        name: "View Agent",
        description: "Agent to view",
        model: "gpt-4o",
        systemPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );
  });

  test("should view an agent successfully", async () => {
    const viewResponse = await fetch(`${url}/api/agent/${createdAgent.id}`, {
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
    expect(viewData.agent.name).toBe("View Agent");
    expect(viewData.agent.description).toBe("Agent to view");
    expect(viewData.agent.model).toBe("gpt-4o");
    expect(viewData.agent.systemPrompt).toBe("You are a helpful assistant.");
    expect(viewData.agent.enabled).toBe(true);
    expect(viewData.agent.userId).toBe(viewUser.id);
    expect(viewData.agent.createdAt).toBeDefined();
    expect(viewData.agent.updatedAt).toBeDefined();
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent/${createdAgent.id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(401);
  });

  test("should not allow viewing another user's agent", async () => {
    // Create another user and session
    const otherUser = {
      name: "View Other User",
      email: "viewother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Try to view the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent/${createdAgent.id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
    });
    expect(response.status).toBe(500);
  });

  test("should return not found for non-existent agent", async () => {
    const response = await fetch(`${url}/api/agent/999999`, {
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
    const testSession = await createUserAndSession(USERS.MARIO);
    listUser = testSession.user;
    listSession = testSession.session;

    // Create 5 agents for this user
    for (let i = 0; i < 5; i++) {
      const agent = await createAgent(
        { user: listUser, session: listSession },
        {
          name: `List Agent ${i}`,
          description: `Agent ${i}`,
          model: "gpt-3.5-turbo",
          systemPrompt: `Agent ${i} system prompt`,
          enabled: false,
        },
      );
      agentIds.push(agent.id);
    }
    // Create an agent for another user
    const otherSession = await createUserAndSession(USERS.BOWSER);
    await createAgent(otherSession, {
      name: "Other User Agent",
      description: "Another user's agent",
      model: "gpt-4o",
      systemPrompt: "You are a helpful assistant.",
      enabled: true,
    });
  });

  test("should list all agents for a user", async () => {
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

  test("should not allow listing another user's agents", async () => {
    // Create another user and agent
    const otherUser = {
      name: "List Other User 2",
      email: "listother2@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);
    await createAgent(otherSession, {
      name: "Other User Agent 2",
      description: "Another user's agent",
      model: "gpt-4o",
      systemPrompt: "You are a helpful assistant.",
      enabled: true,
    });

    // Try to list agents with the first user's session (should only show first user's agents)
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
    for (const agent of data.agents) {
      expect(agent.userId).toBe(listUser.id);
    }
  });
});

describe("agent:tick", () => {
  let tickUser: ActionResponse<SessionCreate>["user"];
  let tickSession: ActionResponse<SessionCreate>["session"];
  let enabledAgent: ActionResponse<AgentCreate>["agent"];
  let disabledAgent: ActionResponse<AgentCreate>["agent"];

  beforeAll(async () => {
    // Get the user and session for ticking
    const testSession = await createUserAndSession(USERS.MARIO);
    tickUser = testSession.user;
    tickSession = testSession.session;

    // Create an enabled agent for testing
    enabledAgent = await createAgent(
      { user: tickUser, session: tickSession },
      {
        name: "Tick Agent",
        description: "Agent to tick",
        model: "gpt-3.5-turbo",
        systemPrompt:
          "You are a helpful assistant. Respond with a simple greeting.",
        enabled: true,
      },
    );

    // Create a disabled agent for testing
    disabledAgent = await createAgent(
      { user: tickUser, session: tickSession },
      {
        name: "Disabled Tick Agent",
        description: "Disabled agent to tick",
        model: "gpt-3.5-turbo",
        systemPrompt: "You are a helpful assistant.",
        enabled: false,
      },
    );
  });

  test("should tick an enabled agent successfully", async () => {
    const tickResponse = await fetch(`${url}/api/agent/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${tickSession.cookieName}=${tickSession.id}`,
      },
      body: JSON.stringify({ id: enabledAgent.id }),
    });

    const tickData = await tickResponse.json();
    expect(tickResponse.status).toBe(200);
    expect(tickData.agent).toBeDefined();
    expect(tickData.agent.id).toBe(enabledAgent.id);
    expect(tickData.response).toBeDefined();
    expect(tickData.message).toBeDefined();
    expect(tickData.message.agentId).toBe(enabledAgent.id);
    expect(tickData.message.role).toBe("assistant");
    expect(tickData.message.content).toBeDefined();
  });

  test("should not tick a disabled agent", async () => {
    const tickResponse = await fetch(`${url}/api/agent/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${tickSession.cookieName}=${tickSession.id}`,
      },
      body: JSON.stringify({ id: disabledAgent.id }),
    });

    expect(tickResponse.status).toBe(500);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agent/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: enabledAgent.id }),
    });
    expect(response.status).toBe(401);
  });

  test("should not allow ticking another user's agent", async () => {
    // Create another user and session
    const otherUser = {
      name: "Tick Other User",
      email: "tickother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Try to tick the first user's agent with the second user's session
    const response = await fetch(`${url}/api/agent/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
      body: JSON.stringify({ id: enabledAgent.id }),
    });
    expect(response.status).toBe(500);
  });

  test("should return not found for non-existent agent", async () => {
    const response = await fetch(`${url}/api/agent/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${tickSession.cookieName}=${tickSession.id}`,
      },
      body: JSON.stringify({ id: 999999 }),
    });
    expect(response.status).toBe(500);
  });
});
