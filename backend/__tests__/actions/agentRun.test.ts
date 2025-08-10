import { test, describe, expect, beforeAll, afterAll, mock } from "bun:test";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import type { SessionCreate } from "../../actions/session";
import {
  createTestUser,
  createUserAndSession,
  createAgent,
  USERS,
} from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

// Mock the OpenAI agents module
const mockRun = mock(() =>
  Promise.resolve({ finalOutput: "Mocked assistant response" }),
);
const mockAgent = mock(() => ({}));
const mockSetDefaultOpenAIClient = mock(() => {});
const mockTool = mock(() => ({}));

mock.module("@openai/agents", () => ({
  Agent: mockAgent,
  run: mockRun,
  setDefaultOpenAIClient: mockSetDefaultOpenAIClient,
  tool: mockTool,
}));

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await createTestUser(USERS.LUIGI);
});

afterAll(async () => {
  await api.stop();
});

describe("agentRun:delete", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agent: any;
  let agentRunId: number;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;

    // Create an agent
    agent = await createAgent(
      { user, session },
      {
        name: "Test Agent for Run Delete",
        description: "Agent to test run deletion",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    // Create an agent run by running the agent
    const runResponse = await fetch(`${url}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({ id: agent.id }),
    });

    const runData = await runResponse.json();
    agentRunId = runData.run.id;
  });

  test("should delete an agent run successfully", async () => {
    const deleteResponse = await fetch(`${url}/api/agentRun`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({ id: agentRunId }),
    });

    expect(deleteResponse.status).toBe(200);
    const deleteData = await deleteResponse.json();
    expect(deleteData.success).toBe(true);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agentRun`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: agentRunId }),
    });

    expect(response.status).toBe(401);
  });

  test("should return false for non-existent agent run", async () => {
    const response = await fetch(`${url}/api/agentRun`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({ id: 999999 }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  test("should not allow deleting another user's agent run", async () => {
    // Create another user and session
    const otherUser = {
      name: "Delete Other User",
      email: "deleteother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Create an agent run for the other user
    const otherAgent = await createAgent(
      { user: otherSession.user, session: otherSession.session },
      {
        name: "Other User Agent",
        description: "Agent owned by other user",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    const runResponse = await fetch(`${url}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
      body: JSON.stringify({ id: otherAgent.id }),
    });

    const runData = await runResponse.json();
    const otherAgentRunId = runData.run.id;

    // Try to delete the other user's agent run with the first user's session
    const response = await fetch(`${url}/api/agentRun`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({ id: otherAgentRunId }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe("agentRun:view", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agent: any;
  let agentRunId: number;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.LUIGI);
    user = testSession.user;
    session = testSession.session;

    // Create an agent
    agent = await createAgent(
      { user, session },
      {
        name: "Test Agent for Run View",
        description: "Agent to test run viewing",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    // Create an agent run by running the agent
    const runResponse = await fetch(`${url}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({ id: agent.id }),
    });

    const runData = await runResponse.json();
    agentRunId = runData.run.id;
  });

  test("should view an agent run successfully", async () => {
    const viewResponse = await fetch(`${url}/api/agentRun/${agentRunId}`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    if (viewResponse.status !== 200) {
      const errorData = await viewResponse.json();
      console.log("View error response:", errorData);
    }
    expect(viewResponse.status).toBe(200);
    const viewData = await viewResponse.json();
    expect(viewData.agentRun).toBeDefined();
    expect(viewData.agentRun.id).toBe(agentRunId);
    expect(viewData.agentRun.agentId).toBe(agent.id);
    expect(viewData.agentRun.status).toBeDefined();
    expect(viewData.agentRun.createdAt).toBeDefined();
    expect(viewData.agentRun.updatedAt).toBeDefined();
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agentRun/${agentRunId}`, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });

  test("should return not found for non-existent agent run", async () => {
    const response = await fetch(`${url}/api/agentRun/999999`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    if (response.status !== 500) {
      const errorData = await response.json();
      console.log("Not found error response:", errorData);
    }
    expect(response.status).toBe(500);
  });

  test("should not allow viewing another user's agent run", async () => {
    // Create another user and session
    const otherUser = {
      name: "View Other User",
      email: "viewother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Create an agent run for the other user
    const otherAgent = await createAgent(
      { user: otherSession.user, session: otherSession.session },
      {
        name: "Other User Agent for View",
        description: "Agent owned by other user",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    const runResponse = await fetch(`${url}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${otherSession.session.cookieName}=${otherSession.session.id}`,
      },
      body: JSON.stringify({ id: otherAgent.id }),
    });

    const runData = await runResponse.json();
    const otherAgentRunId = runData.run.id;

    // Try to view the other user's agent run with the first user's session
    const response = await fetch(`${url}/api/agentRun/${otherAgentRunId}`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(500);
  });
});

describe("agentRun:list", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let agent: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;

    // Create an agent
    agent = await createAgent(
      { user, session },
      {
        name: "Test Agent for Run List",
        description: "Agent to test run listing",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    // Create multiple agent runs by running the agent multiple times
    for (let i = 0; i < 3; i++) {
      await fetch(`${url}/api/agent/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({ id: agent.id }),
      });
    }
  });

  test("should list agent runs successfully", async () => {
    const listResponse = await fetch(
      `${url}/api/agentRuns?agentId=${agent.id}`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(listResponse.status).toBe(200);
    const listData = await listResponse.json();
    expect(listData.agentRuns).toBeDefined();
    expect(Array.isArray(listData.agentRuns)).toBe(true);
    expect(listData.total).toBeDefined();
    expect(listData.total).toBeGreaterThanOrEqual(3);
    expect(listData.agentRuns.length).toBeGreaterThanOrEqual(3);

    // Check that each agent run has the expected structure
    listData.agentRuns.forEach((run: any) => {
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("agentId");
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("createdAt");
      expect(run).toHaveProperty("updatedAt");
      expect(run.agentId).toBe(agent.id);
    });
  });

  test("should support limit and offset", async () => {
    const listResponse = await fetch(
      `${url}/api/agentRuns?agentId=${agent.id}&limit=2&offset=1`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(listResponse.status).toBe(200);
    const listData = await listResponse.json();
    expect(listData.agentRuns).toBeDefined();
    expect(Array.isArray(listData.agentRuns)).toBe(true);
    expect(listData.agentRuns.length).toBeLessThanOrEqual(2);
    expect(listData.total).toBeGreaterThanOrEqual(3);
  });

  test("should require authentication", async () => {
    const response = await fetch(`${url}/api/agentRuns?agentId=${agent.id}`, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });

  test("should not allow listing another user's agent runs", async () => {
    // Create another user and session
    const otherUser = {
      name: "List Other User",
      email: "listother@example.com",
      password: "password123",
    };
    const otherSession = await createUserAndSession(otherUser);

    // Create an agent for the other user
    const otherAgent = await createAgent(
      { user: otherSession.user, session: otherSession.session },
      {
        name: "Other User Agent for List",
        description: "Agent owned by other user",
        model: "gpt-3.5-turbo",
        userPrompt: "You are a helpful assistant.",
        enabled: true,
      },
    );

    // Try to list the other user's agent runs with the first user's session
    const response = await fetch(
      `${url}/api/agentRuns?agentId=${otherAgent.id}`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(500);
  });

  test("should return not found for non-existent agent", async () => {
    const response = await fetch(`${url}/api/agentRuns?agentId=999999`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(500);
  });

  test("should handle missing agentId parameter", async () => {
    const response = await fetch(`${url}/api/agentRuns`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(406);
  });
});
