import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { WorkflowRunStepList } from "../../actions/workflow_run";
import { api } from "../../api";
import { workflow_runs } from "../../models/workflow_run";
import { workflow_run_steps } from "../../models/workflow_run_step";
import {
  createTestAgent,
  createTestWorkflow,
  createTestWorkflowRun,
  createTestWorkflowStep,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

describe("WorkflowRunStepList", () => {
  let userId: number;
  let workflowId: number;
  let workflowRunId: number;
  let workflowStepId: number;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    // Create test user and session
    const testSession = await createUserAndSession(USERS.MARIO);
    userId = testSession.user.id;

    // Create test agent
    const agent = await createTestAgent(userId);

    // Create test workflow
    const workflow = await createTestWorkflow(userId, true);
    workflowId = workflow.id;

    // Create test workflow step
    const workflowStep = await createTestWorkflowStep(workflowId, agent.id);
    workflowStepId = workflowStep.id;

    // Create test workflow run
    const workflowRun = await createTestWorkflowRun(workflowId);
    workflowRunId = workflowRun.id;

    // Create test workflow run step
    await api.db.db.insert(workflow_run_steps).values({
      workflowRunId,
      workflowStepId,
      systemPrompt: "Test system prompt",
      userPrompt: "Test user prompt",
      input: "Test input",
      output: "Test output",
      responseType: "text",
      status: "completed",
      workflowId,
    });
  });

  it("should list workflow run steps successfully", async () => {
    const action = new WorkflowRunStepList();
    const connection = {
      session: { data: { userId } },
    };

    const result = await action.run(
      { id: workflowId, runId: workflowRunId },
      connection as any,
    );

    expect(result.steps).toBeDefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      workflowRunId,
      workflowStepId,
      systemPrompt: "Test system prompt",
      userPrompt: "Test user prompt",
      input: "Test input",
      output: "Test output",
      responseType: "text",
      status: "completed",
      workflowId,
    });
  });

  it("should fail without a session", async () => {
    const action = new WorkflowRunStepList();
    const connection = { session: null };

    await expect(
      action.run({ id: workflowId, runId: workflowRunId }, connection as any),
    ).rejects.toThrow("User session not found");
  });

  it("should fail for non-existent workflow run", async () => {
    const action = new WorkflowRunStepList();
    const connection = {
      session: { data: { userId } },
    };

    expect(
      action.run({ id: workflowId, runId: 99999 }, connection as any),
    ).rejects.toThrow("Workflow run not found");
  });

  it("should fail for another user's workflow run", async () => {
    // Create another user and workflow
    const otherTestSession = await createUserAndSession(USERS.LUIGI);
    const otherUser = otherTestSession.user;
    const otherWorkflow = await createTestWorkflow(otherUser.id, true);

    const [otherWorkflowRun] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId: otherWorkflow.id,
        status: "pending",
        input: null,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })
      .returning();

    const action = new WorkflowRunStepList();
    const connection = {
      session: { data: { userId } },
    };

    await expect(
      action.run(
        { id: otherWorkflow.id, runId: otherWorkflowRun.id },
        connection as any,
      ),
    ).rejects.toThrow("Workflow run not found or not owned by user");
  });

  it("should return empty array when no steps exist", async () => {
    // Create a new workflow run without steps
    const [newWorkflowRun] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId,
        status: "pending",
        input: null,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })
      .returning();

    const action = new WorkflowRunStepList();
    const connection = {
      session: { data: { userId } },
    };

    const result = await action.run(
      { id: workflowId, runId: newWorkflowRun.id },
      connection as any,
    );

    expect(result.steps).toBeDefined();
    expect(result.steps).toHaveLength(0);
  });
});
