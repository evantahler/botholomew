import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { SessionCreate } from "../../actions/session";
import type {
  WorkflowCreate,
  WorkflowDelete,
  WorkflowEdit,
  WorkflowList,
  WorkflowView,
} from "../../actions/workflow";
import { WorkflowRunCreate, WorkflowRunList } from "../../actions/workflow_run";
import {
  WorkflowStepCreate,
  WorkflowStepList,
} from "../../actions/workflow_step";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { createUserAndSession, USERS } from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

describe("Workflow Actions", () => {
  let testUser: ActionResponse<SessionCreate>["user"];
  let testSession: ActionResponse<SessionCreate>["session"];
  let testWorkflow: any;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    await api.db.clearDatabase();
    const testSessionData = await createUserAndSession(USERS.MARIO);
    testUser = testSessionData.user;
    testSession = testSessionData.session;
    // Create a workflow for testing
    const workflowResponse = await fetch(`${url}/api/workflow`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${testSession.cookieName}=${testSession.id}`,
      },
      body: JSON.stringify({
        name: "Test Workflow",
        description: "A test workflow",
        enabled: true,
      }),
    });
    const workflowData = await workflowResponse.json();
    testWorkflow = workflowData.workflow;
  });

  describe("WorkflowCreate", () => {
    test("should create a new workflow", async () => {
      const response = await fetch(`${url}/api/workflow`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          name: "New Test Workflow",
          description: "A new test workflow",
          enabled: false,
        }),
      });

      const result = (await response.json()) as ActionResponse<WorkflowCreate>;
      expect(response.status).toBe(200);
      expect(result.workflow).toBeDefined();
      expect(result.workflow.name).toBe("New Test Workflow");
      expect(result.workflow.description).toBe("A new test workflow");
      expect(result.workflow.enabled).toBe(false);
      expect(result.workflow.userId).toBe(testUser.id);
    });

    test("should require authentication", async () => {
      const response = await fetch(`${url}/api/workflow`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Workflow",
          description: "A test workflow",
          enabled: false,
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("WorkflowList", () => {
    test("should list user's workflows", async () => {
      const response = await fetch(`${url}/api/workflows?limit=10&offset=0`, {
        method: "GET",
        headers: {
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
      });

      const result = (await response.json()) as ActionResponse<WorkflowList>;
      expect(response.status).toBe(200);
      expect(result.workflows).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.workflows.length).toBeGreaterThan(0);
      expect(result.workflows[0].userId).toBe(testUser.id);
    });
  });

  describe("WorkflowView", () => {
    test("should view a specific workflow", async () => {
      const response = await fetch(`${url}/api/workflow/${testWorkflow.id}`, {
        method: "GET",
        headers: {
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
      });

      const result = (await response.json()) as ActionResponse<WorkflowView>;
      expect(response.status).toBe(200);
      expect(result.workflow).toBeDefined();
      expect(result.workflow.id).toBe(testWorkflow.id);
      expect(result.workflow.name).toBe(testWorkflow.name);
    });

    test("should not allow viewing other user's workflow", async () => {
      const otherUserSession = await createUserAndSession(USERS.LUIGI);

      const response = await fetch(`${url}/api/workflow/${testWorkflow.id}`, {
        method: "GET",
        headers: {
          Cookie: `${otherUserSession.session.cookieName}=${otherUserSession.session.id}`,
        },
      });

      expect(response.status).toBe(406);
    });
  });

  describe("WorkflowEdit", () => {
    test("should edit a workflow", async () => {
      const response = await fetch(`${url}/api/workflow/${testWorkflow.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          name: "Updated Workflow",
          enabled: true,
        }),
      });

      const result = (await response.json()) as ActionResponse<WorkflowEdit>;
      expect(response.status).toBe(200);
      expect(result.workflow).toBeDefined();
      expect(result.workflow.name).toBe("Updated Workflow");
      expect(result.workflow.enabled).toBe(true);
    });
  });

  describe("WorkflowStepCreate", () => {
    test("should create a workflow step", async () => {
      // First create a test agent
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          name: "Test Agent",
          description: "A test agent",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: true,
        }),
      });
      const agentData = await agentResponse.json();
      const testAgent = agentData.agent;

      const response = await fetch(
        `${url}/api/workflow/${testWorkflow.id}/step`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${testSession.cookieName}=${testSession.id}`,
          },
          body: JSON.stringify({
            id: testWorkflow.id,
            agentId: testAgent.id,
            position: 1,
          }),
        },
      );

      const result =
        (await response.json()) as ActionResponse<WorkflowStepCreate>;
      expect(response.status).toBe(200);
      expect(result.step).toBeDefined();
      expect(result.step.workflowId).toBe(testWorkflow.id);
      expect(result.step.agentId).toBe(testAgent.id);
      expect(result.step.position).toBe(1);
    });
  });

  describe("WorkflowStepList", () => {
    test("should list workflow steps", async () => {
      // First create a test agent
      const agentResponse = await fetch(`${url}/api/agent`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          name: "Test Agent",
          description: "A test agent",
          model: "gpt-4o",
          userPrompt: "You are a helpful assistant.",
          enabled: true,
        }),
      });
      const agentData = await agentResponse.json();
      const testAgent = agentData.agent;

      // Create a workflow step
      await fetch(`${url}/api/workflow/${testWorkflow.id}/step`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          id: testWorkflow.id,
          agentId: testAgent.id,
          position: 1,
        }),
      });

      const response = await fetch(
        `${url}/api/workflow/${testWorkflow.id}/steps`,
        {
          method: "GET",
          headers: {
            Cookie: `${testSession.cookieName}=${testSession.id}`,
          },
        },
      );

      const result =
        (await response.json()) as ActionResponse<WorkflowStepList>;
      expect(response.status).toBe(200);
      expect(result.steps).toBeDefined();
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe("WorkflowRunCreate", () => {
    test("should create a workflow run", async () => {
      const response = await fetch(
        `${url}/api/workflow/${testWorkflow.id}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${testSession.cookieName}=${testSession.id}`,
          },
          body: JSON.stringify({
            input: "some input",
          }),
        },
      );

      const result =
        (await response.json()) as ActionResponse<WorkflowRunCreate>;

      expect(response.status).toBe(200);
      expect(result.run).toBeDefined();
      expect(result.run.workflowId).toBe(testWorkflow.id);
      expect(result.run.status).toBe("pending");
      expect(result.run.input).toEqual("some input");
    });

    test("should not allow running disabled workflows", async () => {
      // Create a disabled workflow
      const disabledWorkflowResponse = await fetch(`${url}/api/workflow`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          name: "Disabled Workflow",
          description: "A disabled workflow",
          enabled: false,
        }),
      });
      const disabledWorkflowData = await disabledWorkflowResponse.json();
      const disabledWorkflow = disabledWorkflowData.workflow;

      const response = await fetch(
        `${url}/api/workflow/${disabledWorkflow.id}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${testSession.cookieName}=${testSession.id}`,
          },
          body: JSON.stringify({
            input: { test: "data" },
          }),
        },
      );

      expect(response.status).toBe(406);
    });
  });

  describe("WorkflowRunList", () => {
    test("should list workflow runs", async () => {
      // Create a workflow run first
      await fetch(`${url}/api/workflow/${testWorkflow.id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
        body: JSON.stringify({
          input: { test: "data" },
        }),
      });

      const response = await fetch(
        `${url}/api/workflow/${testWorkflow.id}/runs?limit=10&offset=0`,
        {
          method: "GET",
          headers: {
            Cookie: `${testSession.cookieName}=${testSession.id}`,
          },
        },
      );

      const result = (await response.json()) as ActionResponse<WorkflowRunList>;
      expect(response.status).toBe(200);
      expect(result.runs).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.runs.length).toBeGreaterThan(0);
    });
  });

  describe("WorkflowDelete", () => {
    test("should delete a workflow", async () => {
      const response = await fetch(`${url}/api/workflow/${testWorkflow.id}`, {
        method: "DELETE",
        headers: {
          Cookie: `${testSession.cookieName}=${testSession.id}`,
        },
      });

      const result = (await response.json()) as ActionResponse<WorkflowDelete>;
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
    });
  });
});
