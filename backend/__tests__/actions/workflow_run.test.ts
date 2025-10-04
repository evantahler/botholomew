import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { SessionCreate } from "../../actions/session";
import type {
  WorkflowRunCreate,
  WorkflowRunDelete,
  WorkflowRunList,
  WorkflowRunListAll,
  WorkflowRunTick,
  WorkflowRunView,
} from "../../actions/workflow_run";
import { api, type ActionResponse } from "../../api";
import { config } from "../../config";
import { workflow_runs } from "../../models/workflow_run";
import { workflow_steps } from "../../models/workflow_step";
import {
  createTestAgent,
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

    const data = (await response.json()) as ActionResponse<WorkflowRunCreate>;
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

    const data = (await response.json()) as ActionResponse<WorkflowRunCreate>;
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
    const data = (await response.json()) as ActionResponse<WorkflowRunCreate>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow not found or not owned by user");
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
    const data = (await response.json()) as ActionResponse<WorkflowRunCreate>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow is not enabled");
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
    const data = (await response.json()) as ActionResponse<WorkflowRunCreate>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow not found or not owned by user");
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
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<WorkflowRunView>;
    expect(response.status).toBe(200);
    expect(data.run).toBeDefined();
    expect(data.run.id).toBe(workflowRun.id);
    expect(data.run.workflowId).toBe(workflow.id);
    expect(data.run.status).toBe("pending");
  });

  test("should fail to view non-existent workflow run", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/99999`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunView>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow run not found");
  });

  test("should fail to view another user's workflow run", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );
    const otherRun = await createTestWorkflowRun(otherWorkflow.id);

    const response = await fetch(
      `${url}/api/workflow/${otherWorkflow.id}/run/${otherRun.id}`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunView>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe(
      "Workflow run not found or not owned by user",
    );
  });

  test("should fail to view workflow run without session", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}`,
      {
        method: "GET",
      },
    );

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

    const data = (await response.json()) as ActionResponse<WorkflowRunList>;
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

    const data = (await response.json()) as ActionResponse<WorkflowRunList>;
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

    const data = (await response.json()) as ActionResponse<WorkflowRunList>;
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
    const data = (await response.json()) as ActionResponse<WorkflowRunList>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow not found or not owned by user");
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
    const data = (await response.json()) as ActionResponse<WorkflowRunList>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow not found or not owned by user");
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

describe("workflow:run:delete", () => {
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

  test("should delete a workflow run successfully", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}`,
      {
        method: "DELETE",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<WorkflowRunDelete>;
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify the workflow run was actually deleted
    const verifyResponse = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}`,
      {
        method: "GET",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );
    expect(verifyResponse.status).toBe(406);
  });

  test("should fail to delete non-existent workflow run", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/99999`,
      {
        method: "DELETE",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunDelete>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow run not found");
  });

  test("should fail to delete another user's workflow run", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );
    const otherRun = await createTestWorkflowRun(otherWorkflow.id);

    const response = await fetch(
      `${url}/api/workflow/${otherWorkflow.id}/run/${otherRun.id}`,
      {
        method: "DELETE",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunDelete>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe(
      "Workflow run not found or not owned by user",
    );
  });

  test("should fail to delete workflow run without session", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}`,
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(401);
  });
});

describe("workflow:run:tick", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let workflow: any;
  let agent: any;
  let workflowStep: any;
  let workflowRun: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    user = testSession.user;
    session = testSession.session;
    workflow = await createTestWorkflow(user.id, true);
    agent = await createTestAgent(user.id);

    // Create workflow step with proper structure
    workflowStep = await api.db.db
      .insert(workflow_steps)
      .values({
        workflowId: workflow.id,
        agentId: agent.id,
        position: 1,
      })
      .returning();

    workflowStep = workflowStep[0];
    workflowRun = await createTestWorkflowRun(workflow.id);
  });

  // test("should process the first step in a workflow run", async () => {
  //   const response = await fetch(
  //     `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}/tick`,
  //     {
  //       method: "POST",
  //       headers: {
  //         Cookie: `${session.cookieName}=${session.id}`,
  //       },
  //     },
  //   );

  //   const data = await response.json();
  //   expect(response.status).toBe(200);
  //   expect(data.workflowRun).toBeDefined();
  //   expect(data.workflowRun.id).toBe(workflowRun.id);
  //   expect(data.workflowRun.status).toBe("running");

  //   // Verify the workflow run step was created
  //   const runSteps = await api.db.db
  //     .select()
  //     .from(workflow_run_steps)
  //     .where(eq(workflow_run_steps.workflowRunId, workflowRun.id));

  //   expect(runSteps).toHaveLength(1);
  //   expect(runSteps[0].workflowStepId).toBe(workflowStep.id);
  //   expect(runSteps[0].status).toBe("completed");
  // });

  test("should complete workflow run when all steps are done", async () => {
    // Create a new workflow run for this test
    const newWorkflowRun = await createTestWorkflowRun(workflow.id);

    // Execute the tick action
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${newWorkflowRun.id}/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<WorkflowRunTick>;
    expect(response.status).toBe(200);
    expect(data.workflowRun).toBeDefined();

    // Execute tick again to complete the workflow
    const response2 = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${newWorkflowRun.id}/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data2 = (await response2.json()) as ActionResponse<WorkflowRunTick>;
    expect(response2.status).toBe(200);
    expect(data2.workflowRun).toBeDefined();

    // Verify workflow run is marked as completed
    const updatedRun = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.id, newWorkflowRun.id))
      .limit(1);

    expect(updatedRun[0].status).toBe("completed");
    expect(updatedRun[0].completedAt).toBeTruthy();
  });

  test("should handle workflow run with no steps", async () => {
    // Create a workflow with no steps
    const emptyWorkflow = await createTestWorkflow(user.id, true);
    const emptyWorkflowRun = await createTestWorkflowRun(emptyWorkflow.id);

    const response = await fetch(
      `${url}/api/workflow/${emptyWorkflow.id}/run/${emptyWorkflowRun.id}/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    const data = (await response.json()) as ActionResponse<WorkflowRunTick>;
    expect(response.status).toBe(200);
    expect(data.workflowRun).toBeDefined();
    expect(data.workflowRun.status).toBe("pending");
  });

  test("should fail if workflow run is not found", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/99999/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunTick>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow run not found");
  });

  test("should fail if workflow is not owned by user", async () => {
    const otherUserSession = await createUserAndSession(USERS.LUIGI);
    const otherWorkflow = await createTestWorkflow(
      otherUserSession.user.id,
      true,
    );
    const otherRun = await createTestWorkflowRun(otherWorkflow.id);

    const response = await fetch(
      `${url}/api/workflow/${otherWorkflow.id}/run/${otherRun.id}/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunTick>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow not found or not owned by user");
  });

  test("should fail if workflow is disabled", async () => {
    const disabledWorkflow = await createTestWorkflow(user.id, false);
    const disabledRun = await createTestWorkflowRun(disabledWorkflow.id);

    const response = await fetch(
      `${url}/api/workflow/${disabledWorkflow.id}/run/${disabledRun.id}/tick`,
      {
        method: "POST",
        headers: {
          Cookie: `${session.cookieName}=${session.id}`,
        },
      },
    );

    expect(response.status).toBe(406);
    const data = (await response.json()) as ActionResponse<WorkflowRunTick>;
    expect(data.error).toBeDefined();
    expect(data.error!.message).toBe("Workflow is not enabled");
  });

  test("should fail without session", async () => {
    const response = await fetch(
      `${url}/api/workflow/${workflow.id}/run/${workflowRun.id}/tick`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(401);
  });
});

describe("workflow:run:list:all", () => {
  let user: ActionResponse<SessionCreate>["user"];
  let session: ActionResponse<SessionCreate>["session"];
  let workflow1: any;
  let workflow2: any;
  let agent: any;

  beforeAll(async () => {
    const testSession = await createUserAndSession(USERS.LUIGI);
    user = testSession.user;
    session = testSession.session;

    // Create an agent
    agent = await createTestAgent(user.id);

    // Create two workflows
    workflow1 = await createTestWorkflow(user.id, true);
    workflow2 = await createTestWorkflow(user.id, true);

    // Add agent to both workflows
    await api.db.db.insert(workflow_steps).values([
      { workflowId: workflow1.id, agentId: agent.id, position: 1 },
      { workflowId: workflow2.id, agentId: agent.id, position: 1 },
    ]);

    // Create workflow runs with different statuses
    await createTestWorkflowRun(workflow1.id, "completed");
    await createTestWorkflowRun(workflow1.id, "running");
    await createTestWorkflowRun(workflow2.id, "failed");
  });

  test("should list all workflow runs for user", async () => {
    const response = await fetch(`${url}/api/workflows/runs`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as ActionResponse<WorkflowRunListAll>;
    expect(data.runs).toHaveLength(6); // There are more runs from previous tests
    expect(data.total).toBe(6);

    // Check that runs include workflow and agent information
    const run = data.runs[0];
    expect(run.workflowName).toBeDefined();
    expect(run.agents).toBeDefined();
    expect(Array.isArray(run.agents)).toBe(true);
  });

  test("should list workflow runs with pagination", async () => {
    const response = await fetch(`${url}/api/workflows/runs?limit=2&offset=0`, {
      method: "GET",
      headers: {
        Cookie: `${session.cookieName}=${session.id}`,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as ActionResponse<WorkflowRunListAll>;
    expect(data.runs).toHaveLength(2);
    expect(data.total).toBe(6);
  });

  test("should fail without session", async () => {
    const response = await fetch(`${url}/api/workflows/runs`, {
      method: "GET",
    });

    expect(response.status).toBe(401);
  });
});
