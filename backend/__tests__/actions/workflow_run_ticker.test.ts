import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { WorkflowRunTicker } from "../../actions/workflow_run_ticker";
import { api } from "../../api";
import { users } from "../../models/user";
import { workflows } from "../../models/workflow";
import { workflow_runs } from "../../models/workflow_run";

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

beforeEach(async () => {
  await api.db.clearDatabase();
  // Clear the job queue between tests
  await api.actions.delQueue("default");
});

describe("WorkflowRunTicker", () => {
  test("it should enqueue WorkflowRunTick jobs for running workflows", async () => {
    // Create a test user
    const [user] = await api.db.db
      .insert(users)
      .values({
        email: "test@example.com",
        name: "Test User",
        password_hash: "test_hash",
        metadata: "",
      })
      .returning();

    // Create a test workflow
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId: user.id,
        name: "Test Workflow",
        description: "A test workflow",
        enabled: true,
      })
      .returning();

    // Create some workflow runs in different states
    const [runningWorkflow1] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId: workflow.id,
        status: "running",
        input: "test input 1",
      })
      .returning();

    const [runningWorkflow2] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId: workflow.id,
        status: "running",
        input: "test input 2",
      })
      .returning();

    // Create a completed workflow (should not be processed)
    await api.db.db.insert(workflow_runs).values({
      workflowId: workflow.id,
      status: "completed",
      input: "test input 3",
    });

    // Run the ticker action
    const tickerAction = api.actions.actions.find(
      (a) => a.name === "workflow:run:ticker",
    ) as WorkflowRunTicker;

    expect(tickerAction).toBeDefined();

    const result = await tickerAction.run({});

    // Should have found 2 running workflows
    expect(result.success).toBe(true);
    expect(result.enqueuedCount).toBe(2);
    expect(result.totalRunningWorkflows).toBe(2);

    // Verify the jobs are enqueued (this is harder to test without checking the queue directly)
    const queuedJobs = await api.actions.queued("default", 0, 10);
    expect(queuedJobs.length).toBeGreaterThanOrEqual(2);
  });

  test("it should return 0 when no running workflows exist", async () => {
    // Clear all workflow runs
    await api.db.clearDatabase();

    const tickerAction = api.actions.actions.find(
      (a) => a.name === "workflow:run:ticker",
    ) as WorkflowRunTicker;

    const result = await tickerAction.run({});

    expect(result.success).toBe(true);
    expect(result.enqueuedCount).toBe(0);
    expect(result.totalRunningWorkflows).toBe(0);
  });
});
