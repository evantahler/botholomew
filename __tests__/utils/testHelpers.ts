import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { users } from "../../models/user";
import { hashPassword } from "../../ops/UserOps";
import type { SessionCreate } from "../../actions/session";
import { setMaxListeners } from "node:events";

setMaxListeners(999);

const url = config.server.web.applicationUrl;

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export interface TestSession {
  user: ActionResponse<SessionCreate>["user"];
  session: ActionResponse<SessionCreate>["session"];
}

export interface TestAgent {
  id: number;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
}

export interface TestMessage {
  id: number;
  agentId: number;
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Initialize the test environment with a clean database
 */
export async function initializeTestEnvironment() {
  await api.start();
  await api.db.clearDatabase();
}

/**
 * Clean up the test environment
 */
export async function cleanupTestEnvironment() {
  await api.stop();
}

/**
 * Create a test user in the database
 */
export async function createTestUser(userData: TestUser) {
  await api.db.db.insert(users).values({
    name: userData.name,
    email: userData.email,
    password_hash: await hashPassword(userData.password),
  });
}

/**
 * Create a user via API and return the response
 */
export async function createUserViaAPI(userData: TestUser) {
  const response = await fetch(url + "/api/user", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userData),
  });
  return response.json();
}

/**
 * Create a session for a user and return the session data
 */
export async function createSession(userData: TestUser): Promise<TestSession> {
  const sessionRes = await fetch(url + "/api/session", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: userData.email,
      password: userData.password,
    }),
  });
  const sessionResponse =
    (await sessionRes.json()) as ActionResponse<SessionCreate>;
  return {
    user: sessionResponse.user,
    session: sessionResponse.session,
  };
}

/**
 * Create a user and session in one step
 */
export async function createUserAndSession(
  userData: TestUser,
): Promise<TestSession> {
  await createUserViaAPI(userData);
  return createSession(userData);
}

/**
 * Create an agent for a user
 */
export async function createAgent(
  session: TestSession,
  agentData: {
    name: string;
    description: string;
    model: string;
    systemPrompt: string;
    enabled: boolean;
  },
): Promise<TestAgent> {
  const agentResponse = await fetch(`${url}/api/agent`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${session.session.cookieName}=${session.session.id}`,
    },
    body: JSON.stringify(agentData),
  });
  const agentDataResponse = await agentResponse.json();
  return agentDataResponse.agent;
}

/**
 * Create a message for an agent
 */
export async function createMessage(
  session: TestSession,
  messageData: {
    agentId: number;
    role: "user" | "assistant" | "system";
    content: string;
  },
): Promise<TestMessage> {
  const messageResponse = await fetch(`${url}/api/message`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${session.session.cookieName}=${session.session.id}`,
    },
    body: JSON.stringify(messageData),
  });
  const messageDataResponse = await messageResponse.json();
  return messageDataResponse.message;
}

/**
 * Common test user data
 */
export const LUIGIS = {
  MARIO: {
    name: "Mario Mario",
    email: "mario@example.com",
    password: "mushroom1",
  },
  LUIGI: {
    name: "Luigi Mario",
    email: "luigi@example.com",
    password: "password123",
  },
  BOWSER: {
    name: "Bowser Koopa",
    email: "bowser@example.com",
    password: "password123",
  },
} as const;

/**
 * Common agent data
 */
export const TEST_AGENTS = {
  BASIC: {
    name: "Test Agent",
    description: "A test agent",
    model: "gpt-4",
    systemPrompt: "You are a helpful assistant.",
    enabled: true,
  },
  EDITABLE: {
    name: "Original Agent",
    description: "Original description",
    model: "gpt-3.5-turbo",
    systemPrompt: "Original system prompt",
    enabled: false,
  },
} as const;
