import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SessionCreate } from "../../actions/session";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import {
  createTestUser,
  createTestWorkflow,
  createTestWorkflowRun,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

const url = config.server.web.applicationUrl;

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await createTestUser(USERS.LUIGI);
});

afterAll(async () => {
  await api.stop();
});

describe("workflow:run:create", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let workflow: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
    workflow = await createTestWorkflow(user.id, true);
  });

  test("should create a workflow run successfully", async () => {
    const response = await fetch(`${url}/api/workflow/${workflow.id}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        input: "Test input data",
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.run).toBeDefined();
    expect(data.run.workflowId).toBe(workflow.id);
    expect(data.run.status).toBe("pending");
    expect(data.run.input).toBe("Test input data");
    expect(data.run.output).toBeNull();
    expect(data.run.error).toBeNull();
    expect(data.run.startedAt).toBeUndefined();
    expect(data.run.completedAt).toBeUndefined();
  });

  test("should create a workflow run with null input", async () => {
    const response = await fetch(`${url}/api/workflow/${workflow.id}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        input: null,
      }),
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.run).toBeDefined();
    // Note: The framework converts null to the string "null" during processing
    expect(data.run.input).toBe("null");
  });

  test("should fail to create workflow run for non-existent workflow", async () => {
    const response = await fetch(`${url}/api/workflow/99999/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${session.cookieName}=${session.id}`,
      },
      body: JSON.stringify({
        input: "Test input",
      }),
    });

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow not found or not owned by user");
  });

  test("should fail to create workflow run for disabled workflow", async () => {
    const disabledWorkflow = await createTestWorkflow(user.id, false);

    const response = await fetch(
      `${url}/api/workflow/${disabledWorkflow.id}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          input: "Test input",
        }),
      },
    );

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow is not enabled");
  });

  test("should fail to create workflow run for another user's workflow", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );

    const response = await fetch(
      `${url}/api/workflow/${otherWorkflow.id}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${session.cookieName}=${session.id}`,
        },
        body: JSON.stringify({
          input: "Test input",
        }),
      },
    );

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow not found or not owned by user");
  });

  test("should fail to create workflow run without session", async () => {
    const response = await fetch(`${url}/api/workflow/${workflow.id}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: "Test input",
      }),
    });

    expect(response.status).toBe(401);
  });
});

describe("workflow:run:view", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let workflow: any;
  let workflowRun: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
    workflow = await createTestWorkflow(user.id, true);
    workflowRun = await createTestWorkflowRun(workflow.id);
  });

  test("should view a workflow run successfully", async () => {
    const response = await fetch(`${url}/api/workflow/run/${workflowRun.id}`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.run).toBeDefined();
    expect(data.run.id).toBe(workflowRun.id);
    expect(data.run.workflowId).toBe(workflow.id);
    expect(data.run.status).toBe("pending");
  });

  test("should fail to view non-existent workflow run", async () => {
    const response = await fetch(`${url}/api/workflow/run/99999`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow run not found");
  });

  test("should fail to view another user's workflow run", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );
    const otherRun = await createTestWorkflowRun(otherWorkflow.id);

    const response = await fetch(`${url}/api/workflow/run/${otherRun.id}`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe(
      "Workflow run not found or not owned by user",
    );
  });

  test("should fail to view workflow run without session", async () => {
    const response = await fetch(`${url}/api/workflow/run/${workflowRun.id}`, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });
});

describe("workflow:run:list", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let workflow: any;
  let workflowRuns: any[];

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
    workflow = await createTestWorkflow(user.id, true);

    // Create multiple workflow runs
    workflowRuns = [];
    for (let i = 0; i < 5; i++) {
      const run = await createTestWorkflowRun(workflow.id);
      workflowRuns.push(run);
    }
  });

  test("should list workflow runs successfully", async () => {
    const response = await fetch(`${url}/api/workflow/${workflow.id}/runs`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.runs).toBeDefined();
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(5);
    expect(data.runs.length).toBeGreaterThanOrEqual(5);
  });

  test("should list workflow runs with limit", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/runs?limit=3`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.runs).toBeDefined();
    expect(data.runs.length).toBeLessThanOrEqual(3);
  });

  test("should list workflow runs with offset", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/runs?limit=2&offset=2`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.runs).toBeDefined();
    expect(data.runs.length).toBeLessThanOrEqual(2);
  });

  test("should fail to list runs for non-existent workflow", async () => {
    const response = await fetch(`${url}/api/workflow/99999/runs`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow not found or not owned by user");
  });

  test("should fail to list runs for another user's workflow", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );

    const response = await fetch(
      `${url}/api/workflow/${otherWorkflow.id}/runs`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Workflow not found or not owned by user");
  });

  test("should fail to list workflow runs without session", async () => {
    const response = await fetch(`${url}/api/workflow/${workflow.id}/runs`, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });

  test("should handle invalid limit parameter", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/runs?limit=0`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
  });

  test("should handle invalid offset parameter", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/runs?offset=-1`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
  });
});
