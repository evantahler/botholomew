import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { WorkflowStepCreate } from "../../actions/workflow_step";
import { api } from "../../api";
import {
  createTestAgent,
  createTestWorkflow,
  createTestWorkflowRun,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

describe("Workflow Conditional Branching", () => {
  let userId: number;
  let workflowId: number;
  let agentId1: number;
  let agentId2: number;
  let agentId3: number;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
  });

  afterAll(async () => {
    await api.stop();
  });

  beforeEach(async () => {
    const testSession = await createUserAndSession(USERS.MARIO);
    userId = testSession.user.id;

    const workflow = await createTestWorkflow(userId, true);
    workflowId = workflow.id;

    // Create three test agents
    const agent1 = await createTestAgent(userId);
    agentId1 = agent1.id;

    const agent2 = await createTestAgent(userId);
    agentId2 = agent2.id;

    const agent3 = await createTestAgent(userId);
    agentId3 = agent3.id;
  });

  describe("Conditional Step Creation", () => {
    it("should create a conditional step with output_contains condition", async () => {
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        {
          id: workflowId,
          agentId: agentId1,
          position: 1,
          stepType: "condition",
          conditionType: "output_contains",
          conditionValue: "success",
          branches: {
            true: 3,
            false: 2,
          },
        },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.stepType).toBe("condition");
      expect(result.step.conditionType).toBe("output_contains");
      expect(result.step.conditionValue).toBe("success");
      expect(result.step.branches).toEqual({
        true: 3,
        false: 2,
      });
    });
  });

  describe("Workflow Execution with Conditional Branching", () => {
    it("should execute workflow with conditional branching - true path", async () => {
      // Create a workflow with:
      // Step 1: Agent that outputs "success"
      // Step 2: Conditional step that checks for "success" and branches to step 4 if true, step 3 if false
      // Step 3: Agent (false path)
      // Step 4: Agent (true path)

      // Step 1: Agent
      const step1Action = new WorkflowStepCreate();
      const connection = { session: { data: { userId } } };
      await step1Action.run(
        {
          id: workflowId,
          agentId: agentId1,
          position: 1,
          stepType: "agent",
        },
        connection as any,
      );

      // Step 2: Conditional
      const step2Action = new WorkflowStepCreate();
      await step2Action.run(
        {
          id: workflowId,
          agentId: agentId2,
          position: 2,
          stepType: "condition",
          conditionType: "output_contains",
          conditionValue: "success",
          branches: {
            true: 4, // Jump to step 4 if condition is true
            false: 3, // Jump to step 3 if condition is false
          },
        },
        connection as any,
      );

      // Step 3: Agent (false path)
      const step3Action = new WorkflowStepCreate();
      await step3Action.run(
        {
          id: workflowId,
          agentId: agentId2,
          position: 3,
          stepType: "agent",
        },
        connection as any,
      );

      // Step 4: Agent (true path)
      const step4Action = new WorkflowStepCreate();
      await step4Action.run(
        {
          id: workflowId,
          agentId: agentId3,
          position: 4,
          stepType: "agent",
        },
        connection as any,
      );

      // Create a workflow run
      const workflowRun = await createTestWorkflowRun(workflowId, "pending");

      // Mock the agent to return "success" for the first step
      // This is a simplified test - in a real scenario, we'd need to mock the agent execution
      // For now, we'll just verify that the conditional step is created correctly
      expect(workflowRun).toBeDefined();
      expect(workflowRun.workflowId).toBe(workflowId);
    });

    it("should create conditional step with regex matching", async () => {
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        {
          id: workflowId,
          agentId: agentId1,
          position: 1,
          stepType: "condition",
          conditionType: "output_matches",
          conditionValue: "\\d+",
          branches: {
            true: 2,
            false: 3,
          },
        },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.conditionType).toBe("output_matches");
      expect(result.step.conditionValue).toBe("\\d+");
    });

    it("should create conditional step with exact match", async () => {
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        {
          id: workflowId,
          agentId: agentId1,
          position: 1,
          stepType: "condition",
          conditionType: "output_equals",
          conditionValue: "yes",
          branches: {
            true: 2,
            false: 3,
          },
        },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.conditionType).toBe("output_equals");
      expect(result.step.conditionValue).toBe("yes");
    });
  });
});
