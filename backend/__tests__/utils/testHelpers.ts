import { setMaxListeners } from "node:events";
import type { AgentCreate } from "../../actions/agent";
import type { SessionCreate } from "../../actions/session";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { agents } from "../../models/agent";
import { users } from "../../models/user";
import { workflows } from "../../models/workflow";
import { workflow_runs, WorkflowRun } from "../../models/workflow_run";
import { workflow_steps } from "../../models/workflow_step";
import { hashPassword } from "../../ops/UserOps";

// TODO: Github Actions needs this, but not locally.  Why?
setMaxListeners(999);

const url = config.server.web.applicationUrl;

export interface TestUser {
  name: string;
  email: string;
  password: string;
  metadata?: string;
}

export interface TestSession {
  user: ActionResponse<SessionCreate>["user"];
  session: ActionResponse<SessionCreate>["session"];
}

/**
 * Create a test user in the database
 */
export async function createTestUser(userData: TestUser) {
  await api.db.db.insert(users).values({
    name: userData.name,
    email: userData.email,
    password_hash: await hashPassword(userData.password),
    metadata: userData.metadata || "",
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
    userPrompt: string;
    enabled: boolean;
    toolkits?: string[] | string;
    responseType?: "text" | "json" | "markdown";
  },
): Promise<ActionResponse<AgentCreate>["agent"]> {
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
 * Common test user data
 */
export const USERS = {
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
 * Create a test workflow for testing
 */
export async function createTestWorkflow(
  userId: number,
  enabled: boolean = true,
) {
  const [workflow] = await api.db.db
    .insert(workflows)
    .values({
      userId,
      name: "Test Workflow",
      description: "A test workflow",
      enabled,
    })
    .returning();
  return workflow;
}

/**
 * Create a test agent for testing
 */
export async function createTestAgent(userId: number) {
  const [agent] = await api.db.db
    .insert(agents)
    .values({
      userId,
      name: "Test Agent",
      description: "A test agent",
      model: "gpt-4o",
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "You are a helpful assistant.",
      responseType: "text",
      enabled: true,
      toolkits: [],
    })
    .returning();
  return agent;
}

/**
 * Create a test workflow step for testing
 */
export async function createTestWorkflowStep(
  workflowId: number,
  agentId: number,
) {
  const [step] = await api.db.db
    .insert(workflow_steps)
    .values({
      workflowId,
      agentId,
      position: 1,
    })
    .returning();
  return step;
}

/**
 * Create a test workflow run for testing
 */
export async function createTestWorkflowRun(
  workflowId: number,
  status: WorkflowRun["status"] = "pending",
) {
  const [run] = await api.db.db
    .insert(workflow_runs)
    .values({
      workflowId,
      status,
      input: "Test input",
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
    })
    .returning();
  return run;
}

// Export all test helpers as a single object
export const testHelpers = {
  createTestUser,
  createTestWorkflow,
  createTestAgent,
  createTestWorkflowStep,
  createTestWorkflowRun,
};

/**
 * Common agent data
 */
export const TEST_AGENTS = {
  BASIC: {
    name: "Test Agent",
    description: "A test agent",
    model: "gpt-4o",
    userPrompt: "You are a helpful assistant.",
    enabled: true,
  },
  EDITABLE: {
    name: "Original Agent",
    description: "Original description",
    model: "gpt-3.5-turbo",
    userPrompt: "Original user prompt",
    enabled: false,
  },
  WITH_TOOLKITS: {
    name: "Toolkit Agent",
    description: "An agent with toolkits",
    model: "gpt-4o",
    userPrompt: "You are a helpful assistant with toolkit access.",
    enabled: true,
    toolkits: ["web_search", "file_operations"],
  },
  SINGLE_TOOLKIT: {
    name: "Single Toolkit Agent",
    description: "An agent with one toolkit",
    model: "gpt-4o",
    userPrompt: "You are a helpful assistant.",
    enabled: false,
    toolkits: "web_search",
  },
} as const;
