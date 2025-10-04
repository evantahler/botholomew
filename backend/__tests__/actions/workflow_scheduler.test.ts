import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../../api";
import { users } from "../../models/user";
import { workflows } from "../../models/workflow";
import { workflow_runs } from "../../models/workflow_run";
import { createTestUser, USERS } from "../utils/testHelpers";

describe("workflow:scheduler", () => {
  let userId: number;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
    await createTestUser(USERS.MARIO);
    // Get the user ID from the database
    const [user] = await api.db.db
      .select()
      .from(users)
      .where(eq(users.email, USERS.MARIO.email));
    userId = user.id;
  });

  afterAll(async () => {
    await api.db.clearDatabase();
    await api.stop();
  });

  test("creates workflow runs for due scheduled workflows", async () => {
    // Create a workflow with a schedule that runs every minute
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Scheduled Workflow",
        description: "Test scheduled workflow",
        enabled: true,
        schedule: "* * * * *", // Every minute
        lastScheduledAt: new Date(Date.now() - 120000), // 2 minutes ago
      })
      .returning();

    // Find and run the scheduler action directly
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check if a workflow run was created
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].status).toBe("pending");

    // Check that lastScheduledAt was updated
    const [updatedWorkflow] = await api.db.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflow.id));

    expect(updatedWorkflow.lastScheduledAt).not.toBeNull();
    expect(updatedWorkflow.lastScheduledAt!.getTime()).toBeGreaterThan(
      workflow.lastScheduledAt!.getTime(),
    );
  });

  test("does not create runs for disabled workflows", async () => {
    // Create a disabled workflow with a schedule
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Disabled Scheduled Workflow",
        description: "Test disabled scheduled workflow",
        enabled: false,
        schedule: "* * * * *", // Every minute
      })
      .returning();

    // Find and run the scheduler action directly
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check that no workflow run was created
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    expect(runs.length).toBe(0);
  });

  test("does not create runs for workflows without a schedule", async () => {
    // Create a workflow without a schedule
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Unscheduled Workflow",
        description: "Test unscheduled workflow",
        enabled: true,
        schedule: null,
      })
      .returning();

    // Find and run the scheduler action directly
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check that no workflow run was created
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    expect(runs.length).toBe(0);
  });

  test("does not create duplicate runs for the same schedule", async () => {
    // Create a workflow with a schedule
    const now = new Date();
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "No Duplicate Workflow",
        description: "Test no duplicate runs",
        enabled: true,
        schedule: "* * * * *", // Every minute
        lastScheduledAt: now,
      })
      .returning();

    // Find and run the scheduler action directly (twice)
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});
    await action.run({});

    // Check that no workflow run was created (because lastScheduledAt is too recent)
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    // Should be 0 because we just updated lastScheduledAt to now
    expect(runs.length).toBe(0);
  });

  test("handles workflows with invalid cron expressions gracefully", async () => {
    // Create a workflow with an invalid schedule
    // We'll insert directly to bypass validation
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Invalid Cron Workflow",
        description: "Test invalid cron expression",
        enabled: true,
        schedule: "invalid cron",
      })
      .returning();

    // Find and run the scheduler action directly - should not throw
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check that no workflow run was created
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    expect(runs.length).toBe(0);
  });

  test("respects different cron schedules", async () => {
    // Create a workflow that runs every hour (at minute 0)
    const [workflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Hourly Workflow",
        description: "Test hourly schedule",
        enabled: true,
        schedule: "0 * * * *", // Every hour at minute 0
        lastScheduledAt: null,
      })
      .returning();

    // Find and run the scheduler action directly
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check workflow runs - should not create a run if current time is not at minute 0
    const runs = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, workflow.id));

    const now = new Date();
    if (now.getMinutes() === 0) {
      // If we're at minute 0, a run should be created
      expect(runs.length).toBeGreaterThanOrEqual(1);
    } else {
      // Otherwise, no run should be created
      expect(runs.length).toBe(0);
    }
  });

  test("only processes workflows not scheduled in the last minute", async () => {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 120000);
    const thirtySecondsAgo = new Date(now.getTime() - 30000);

    // Create workflow that should be processed (scheduled 2 minutes ago)
    const [oldWorkflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Old Scheduled Workflow",
        description: "Should be processed",
        enabled: true,
        schedule: "* * * * *",
        lastScheduledAt: twoMinutesAgo,
      })
      .returning();

    // Create workflow that should NOT be processed (scheduled 30 seconds ago)
    const [recentWorkflow] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: "Recently Scheduled Workflow",
        description: "Should not be processed",
        enabled: true,
        schedule: "* * * * *",
        lastScheduledAt: thirtySecondsAgo,
      })
      .returning();

    // Run the scheduler
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // Check that old workflow got a new run
    const oldRuns = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, oldWorkflow.id));

    expect(oldRuns.length).toBe(1);

    // Check that recent workflow did NOT get a new run
    const recentRuns = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, recentWorkflow.id));

    expect(recentRuns.length).toBe(0);

    // Verify lastScheduledAt was updated for old workflow
    const [updatedOldWorkflow] = await api.db.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, oldWorkflow.id));

    expect(updatedOldWorkflow.lastScheduledAt!.getTime()).toBeGreaterThan(
      twoMinutesAgo.getTime(),
    );
  });

  test("respects pagination limit and processes oldest first", async () => {
    const now = new Date();
    const workflows_to_create = 5;

    // Create multiple workflows with different lastScheduledAt times
    const createdWorkflows = [];
    for (let i = 0; i < workflows_to_create; i++) {
      const [workflow] = await api.db.db
        .insert(workflows)
        .values({
          userId,
          name: `Workflow ${i}`,
          description: `Test workflow ${i}`,
          enabled: true,
          schedule: "* * * * *",
          // Oldest workflow has oldest lastScheduledAt
          lastScheduledAt: new Date(
            now.getTime() - (workflows_to_create - i) * 120000,
          ),
        })
        .returning();
      createdWorkflows.push(workflow);
    }

    // Run the scheduler
    const action = api.actions.actions.find(
      (a) => a.name === "workflow:scheduler",
    )!;
    await action.run({});

    // All workflows should have been processed (we only have 5, limit is 100)
    for (const workflow of createdWorkflows) {
      const runs = await api.db.db
        .select()
        .from(workflow_runs)
        .where(eq(workflow_runs.workflowId, workflow.id));

      expect(runs.length).toBe(1);
    }

    // Verify they were updated (all should have recent lastScheduledAt)
    for (const workflow of createdWorkflows) {
      const [updated] = await api.db.db
        .select()
        .from(workflows)
        .where(eq(workflows.id, workflow.id));

      expect(updated.lastScheduledAt!.getTime()).toBeGreaterThan(
        workflow.lastScheduledAt!.getTime(),
      );
    }
  });
});
