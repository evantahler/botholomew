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
import { agentTick } from "../../ops/AgentOps";
import { agent_run } from "../../models/agent_run";
import { agents } from "../../models/agent";
import { eq } from "drizzle-orm";

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

describe("agentTick", () => {
  let testUser: ActionResponse<SessionCreate>["user"];
  let testSession: ActionResponse<SessionCreate>["session"];
  let testAgent: any;

  beforeAll(async () => {
    const session = await createUserAndSession(USERS.MARIO);
    testUser = session.user;
    testSession = session.session;

    // Create a test agent
    testAgent = await createAgent(
      { user: testUser, session: testSession },
      {
        name: "Test Agent",
        description: "A test agent for ticking",
        model: "gpt-3.5-turbo",
        userPrompt: "Hello, how are you?",
        enabled: true,
      },
    );
  });

  test("should tick an agent and generate a response", async () => {
    // Get the agent from the database
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, testAgent.id))
      .limit(1);

    expect(agent).toBeDefined();

    // Run the agent tick
    const result = await agentTick(agent);

    // Verify the result
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.status).toBe("completed");

    // Verify that a new agent run was created
    const newAgentRuns = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.agentId, testAgent.id))
      .orderBy(agent_run.createdAt);

    expect(newAgentRuns.length).toBeGreaterThanOrEqual(1);

    const lastRun = newAgentRuns[newAgentRuns.length - 1];
    expect(lastRun.agentId).toBe(testAgent.id);
    expect(lastRun.status).toBe("completed");
    expect(lastRun.response).toBe(result.response);
  });

  test("should handle agent with no conversation history", async () => {
    // Create a new agent with no previous runs
    const newAgent = await createAgent(
      { user: testUser, session: testSession },
      {
        name: "Empty Agent",
        description: "An agent with no conversation history",
        model: "gpt-3.5-turbo",
        userPrompt: "Introduce yourself.",
        enabled: true,
      },
    );

    // Get the agent from the database
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, newAgent.id))
      .limit(1);

    expect(agent).toBeDefined();

    // Run the agent tick
    const result = await agentTick(agent);

    // Verify the result
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.status).toBe("completed");

    // Verify that an agent run was created
    const newAgentRuns = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.agentId, newAgent.id))
      .orderBy(agent_run.createdAt);

    expect(newAgentRuns.length).toBe(1);
    expect(newAgentRuns[0].agentId).toBe(newAgent.id);
    expect(newAgentRuns[0].status).toBe("completed");
    expect(newAgentRuns[0].response).toBe(result.response);
  });

  test("should handle agent with multiple conversation turns", async () => {
    // Create a new agent for this test
    const multiTurnAgent = await createAgent(
      { user: testUser, session: testSession },
      {
        name: "Multi-Turn Agent",
        description: "An agent for testing multiple conversation turns",
        model: "gpt-3.5-turbo",
        userPrompt: "Keep responses concise.",
        enabled: true,
      },
    );

    // Get the agent from the database
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, multiTurnAgent.id))
      .limit(1);

    expect(agent).toBeDefined();

    // Run the agent tick multiple times to simulate conversation turns
    const result1 = await agentTick(agent);
    const result2 = await agentTick(agent);

    // Verify the results
    expect(result1).toBeDefined();
    expect(result1.response).toBeDefined();
    expect(result1.status).toBe("completed");

    expect(result2).toBeDefined();
    expect(result2.response).toBeDefined();
    expect(result2.status).toBe("completed");

    // Verify that multiple agent runs were created
    const allAgentRuns = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.agentId, multiTurnAgent.id))
      .orderBy(agent_run.createdAt);

    expect(allAgentRuns.length).toBe(2);

    const firstRun = allAgentRuns[0];
    const secondRun = allAgentRuns[1];

    expect(firstRun.agentId).toBe(multiTurnAgent.id);
    expect(firstRun.status).toBe("completed");
    expect(firstRun.response).toBe(result1.response);

    expect(secondRun.agentId).toBe(multiTurnAgent.id);
    expect(secondRun.status).toBe("completed");
    expect(secondRun.response).toBe(result2.response);
  });
});
