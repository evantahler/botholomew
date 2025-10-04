import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorkflowRunTickSystem } from "../../actions/workflow_run_tick_system";
import { api } from "../../api";
import { Agent, agents } from "../../models/agent";
import { users } from "../../models/user";
import { Workflow, workflows } from "../../models/workflow";
import { workflow_runs, WorkflowRun } from "../../models/workflow_run";
import { workflow_steps } from "../../models/workflow_step";

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
});

afterAll(async () => {
  await api.stop();
});

describe("WorkflowRunTickSystem", () => {
  test("it should process a workflow run step without requiring authentication", async () => {
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

    // Create a test agent
    const [agent]: Agent[] = await api.db.db
      .insert(agents)
      .values({
        userId: user.id,
        name: "Test Agent",
        description: "A test agent",
        systemPrompt: "You are a helpful assistant",
        userPrompt: "Say hello",
        model: "gpt-4",
        responseType: "text",
      })
      .returning();

    // Create a test workflow
    const [workflow]: Workflow[] = await api.db.db
      .insert(workflows)
      .values({
        userId: user.id,
        name: "Test Workflow",
        description: "A test workflow",
        enabled: true,
      })
      .returning();

    // Create a workflow step
    await api.db.db.insert(workflow_steps).values({
      workflowId: workflow.id,
      agentId: agent.id,
      position: 0,
    });

    // Create a pending workflow run
    const [workflowRun]: WorkflowRun[] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId: workflow.id,
        status: "pending",
        input: "test input",
        currentStep: 0,
      })
      .returning();

    // Run the system-level tick action
    const tickAction = api.actions.actions.find(
      (a) => a.name === "workflow:run:tick:system",
    ) as WorkflowRunTickSystem;

    expect(tickAction).toBeDefined();

    const result = await tickAction.run({
      id: workflow.id,
      runId: workflowRun.id,
    });

    expect(result.workflowRun).toBeDefined();
    expect(result.workflowRun.id).toBe(workflowRun.id);
  });

  test("it should handle non-existent workflow run", async () => {
    const tickAction = api.actions.actions.find(
      (a) => a.name === "workflow:run:tick:system",
    ) as WorkflowRunTickSystem;

    expect(tickAction).toBeDefined();

    await expect(
      tickAction.run({
        id: 999,
        runId: 999,
      }),
    ).rejects.toThrow("Workflow run not found");
  });
});
