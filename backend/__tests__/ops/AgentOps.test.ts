import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import type { SessionCreate } from "../../actions/session";
import {
  createTestUser,
  createUserAndSession,
  createAgent,
  createMessage,
  USERS,
} from "../utils/testHelpers";
import { agentTick } from "../../ops/AgentOps";
import { messages } from "../../models/message";
import { agents } from "../../models/agent";
import { eq } from "drizzle-orm";

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
        systemPrompt:
          "You are a helpful assistant. Respond with a simple greeting.",
        enabled: true,
      },
    );
  });

  test("should tick an agent and generate a response", async () => {
    // Add a user message to the conversation
    await createMessage(
      { user: testUser, session: testSession },
      {
        agentId: testAgent.id,
        role: "user",
        content: "Hello, how are you?",
      },
    );

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
    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe("string");

    // Verify that a new assistant message was created
    const newMessages = await api.db.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, testAgent.id))
      .orderBy(messages.createdAt);

    expect(newMessages.length).toBeGreaterThanOrEqual(2); // Original user message + new assistant message

    const lastMessage = newMessages[newMessages.length - 1];
    expect(lastMessage.role).toBe("assistant");
    expect(lastMessage.content).toBe(result.output);
  });

  test("should handle agent with no conversation history", async () => {
    // Create a new agent with no messages
    const newAgent = await createAgent(
      { user: testUser, session: testSession },
      {
        name: "Empty Agent",
        description: "An agent with no conversation history",
        model: "gpt-3.5-turbo",
        systemPrompt: "You are a helpful assistant. Introduce yourself.",
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
    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe("string");

    // Verify that an assistant message was created
    const newMessages = await api.db.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, newAgent.id));

    expect(newMessages.length).toBe(1);
    expect(newMessages[0].role).toBe("assistant");
    expect(newMessages[0].content).toBe(result.output);
  });

  test("should handle agent with multiple conversation turns", async () => {
    // Create a new agent for this test
    const multiTurnAgent = await createAgent(
      { user: testUser, session: testSession },
      {
        name: "Multi-Turn Agent",
        description: "An agent for testing multiple conversation turns",
        model: "gpt-3.5-turbo",
        systemPrompt: "You are a helpful assistant. Keep responses concise.",
        enabled: true,
      },
    );

    // Add multiple messages to create a conversation
    await createMessage(
      { user: testUser, session: testSession },
      {
        agentId: multiTurnAgent.id,
        role: "user",
        content: "What's the weather like?",
      },
    );

    await createMessage(
      { user: testUser, session: testSession },
      {
        agentId: multiTurnAgent.id,
        role: "assistant",
        content: "I don't have access to real-time weather data.",
      },
    );

    await createMessage(
      { user: testUser, session: testSession },
      {
        agentId: multiTurnAgent.id,
        role: "user",
        content: "Can you help me with something else?",
      },
    );

    // Get the agent from the database
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, multiTurnAgent.id))
      .limit(1);

    expect(agent).toBeDefined();

    // Run the agent tick
    const result = await agentTick(agent);

    // Verify the result
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe("string");

    // Verify that a new assistant message was created
    const allMessages = await api.db.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, multiTurnAgent.id))
      .orderBy(messages.createdAt);

    expect(allMessages.length).toBe(4); // 3 original messages + 1 new assistant message

    const lastMessage = allMessages[allMessages.length - 1];
    expect(lastMessage.role).toBe("assistant");
    expect(typeof lastMessage.content).toBe("string");
  });
});
