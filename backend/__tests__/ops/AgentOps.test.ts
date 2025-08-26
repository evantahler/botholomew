import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { SessionCreate } from "../../actions/session";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { agents } from "../../models/agent";
import { agent_run } from "../../models/agent_run";
import { agentTick } from "../../ops/AgentOps";
import {
  createAgent,
  createTestUser,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

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

    // Create an agent run first
    const [agentRun] = await api.db.db
      .insert(agent_run)
      .values({
        agentId: agent.id,
        systemPrompt: agent.systemPrompt,
        userMessage: agent.userPrompt,
        response: null,
        type: agent.responseType,
        status: "pending",
      })
      .returning();

    // Run the agent tick
    const result = await agentTick(agent, agentRun);

    // Verify the result
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.status).toBe("completed");

    // Verify that the agent run was updated
    const updatedRun = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.id, agentRun.id))
      .limit(1);

    expect(updatedRun[0]).toBeDefined();
    expect(updatedRun[0].status).toBe("completed");
    expect(updatedRun[0].response).toBe(result.response);
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

    // Create an agent run first
    const [agentRun] = await api.db.db
      .insert(agent_run)
      .values({
        agentId: agent.id,
        systemPrompt: agent.systemPrompt,
        userMessage: agent.userPrompt,
        response: null,
        type: agent.responseType,
        status: "pending",
      })
      .returning();

    // Run the agent tick
    const result = await agentTick(agent, agentRun);

    // Verify the result
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.status).toBe("completed");

    // Verify that the agent run was updated
    const updatedRun = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.id, agentRun.id))
      .limit(1);

    expect(updatedRun[0]).toBeDefined();
    expect(updatedRun[0].status).toBe("completed");
    expect(updatedRun[0].response).toBe(result.response);
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

    // Create agent runs for multiple turns
    const [agentRun1] = await api.db.db
      .insert(agent_run)
      .values({
        agentId: agent.id,
        systemPrompt: agent.systemPrompt,
        userMessage: agent.userPrompt,
        response: null,
        type: agent.responseType,
        status: "pending",
      })
      .returning();

    const [agentRun2] = await api.db.db
      .insert(agent_run)
      .values({
        agentId: agent.id,
        systemPrompt: agent.systemPrompt,
        userMessage: agent.userPrompt,
        response: null,
        type: agent.responseType,
        status: "pending",
      })
      .returning();

    // Run the agent tick multiple times to simulate conversation turns
    const result1 = await agentTick(agent, agentRun1);
    const result2 = await agentTick(agent, agentRun2);

    // Verify the results
    expect(result1).toBeDefined();
    expect(result1.response).toBeDefined();
    expect(result1.status).toBe("completed");

    expect(result2).toBeDefined();
    expect(result2.response).toBeDefined();
    expect(result2.status).toBe("completed");

    // Verify that both agent runs were updated
    const updatedRun1 = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.id, agentRun1.id))
      .limit(1);

    const updatedRun2 = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.id, agentRun2.id))
      .limit(1);

    expect(updatedRun1[0]).toBeDefined();
    expect(updatedRun1[0].status).toBe("completed");
    expect(updatedRun1[0].response).toBe(result1.response);

    expect(updatedRun2[0]).toBeDefined();
    expect(updatedRun2[0].status).toBe("completed");
    expect(updatedRun2[0].response).toBe(result2.response);
  });
});
