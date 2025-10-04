import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  WorkflowStepCreate,
  WorkflowStepDelete,
  WorkflowStepEdit,
  WorkflowStepList,
} from "../../actions/workflow_step";
import { api } from "../../api";
import {
  createTestAgent,
  createTestWorkflow,
  createTestWorkflowStep,
  createUserAndSession,
  USERS,
} from "../utils/testHelpers";

describe("WorkflowStep Actions", () => {
  let userId: number;
  let workflowId: number;
  let agentId: number;

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

    const agent = await createTestAgent(userId);
    agentId = agent.id;
  });

  describe("WorkflowStepCreate", () => {
    it("should create a workflow step successfully", async () => {
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        { id: workflowId, agentId, position: 1 },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.workflowId).toBe(workflowId);
      expect(result.step.agentId).toBe(agentId);
      expect(result.step.position).toBe(1);
    });

    it("should create a step with another agent", async () => {
      const agent2 = await createTestAgent(userId);
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        { id: workflowId, agentId: agent2.id, position: 2 },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.agentId).toBe(agent2.id);
      expect(result.step.position).toBe(2);
    });

    it("should fail for non-existent workflow", async () => {
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId } },
      };

      await expect(
        action.run({ id: 99999, position: 1 }, connection as any),
      ).rejects.toThrow("Workflow not found or not owned by user");
    });

    it("should fail for another user's workflow", async () => {
      const otherSession = await createUserAndSession(USERS.LUIGI);
      const action = new WorkflowStepCreate();
      const connection = {
        session: { data: { userId: otherSession.user.id } },
      };

      await expect(
        action.run({ id: workflowId, position: 1 }, connection as any),
      ).rejects.toThrow("Workflow not found or not owned by user");
    });
  });

  describe("WorkflowStepEdit", () => {
    it("should edit a workflow step successfully", async () => {
      const step = await createTestWorkflowStep(workflowId, agentId);

      const action = new WorkflowStepEdit();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        { id: workflowId, stepId: step.id, position: 5 },
        connection as any,
      );

      expect(result.step).toBeDefined();
      expect(result.step.position).toBe(5);
      expect(result.step.agentId).toBe(agentId);
    });

    it("should update agent on a step", async () => {
      const step = await createTestWorkflowStep(workflowId, agentId);
      const newAgent = await createTestAgent(userId);

      const action = new WorkflowStepEdit();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        { id: workflowId, stepId: step.id, agentId: newAgent.id },
        connection as any,
      );

      expect(result.step.agentId).toBe(newAgent.id);
    });

    it("should fail for non-existent step", async () => {
      const action = new WorkflowStepEdit();
      const connection = {
        session: { data: { userId } },
      };

      await expect(
        action.run({ id: workflowId, stepId: 99999 }, connection as any),
      ).rejects.toThrow("Workflow step not found or not owned by user");
    });

    it("should fail for another user's workflow step", async () => {
      const step = await createTestWorkflowStep(workflowId, agentId);
      const otherSession = await createUserAndSession(USERS.LUIGI);

      const action = new WorkflowStepEdit();
      const connection = {
        session: { data: { userId: otherSession.user.id } },
      };

      await expect(
        action.run({ id: workflowId, stepId: step.id }, connection as any),
      ).rejects.toThrow("Workflow step not found or not owned by user");
    });
  });

  describe("WorkflowStepDelete", () => {
    it("should delete a workflow step successfully", async () => {
      const step = await createTestWorkflowStep(workflowId, agentId);

      const action = new WorkflowStepDelete();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run(
        { id: workflowId, stepId: step.id },
        connection as any,
      );

      expect(result.success).toBe(true);
    });

    it("should fail for non-existent step", async () => {
      const action = new WorkflowStepDelete();
      const connection = {
        session: { data: { userId } },
      };

      await expect(
        action.run({ id: workflowId, stepId: 99999 }, connection as any),
      ).rejects.toThrow("Workflow step not found or not owned by user");
    });

    it("should fail for another user's workflow step", async () => {
      const step = await createTestWorkflowStep(workflowId, agentId);
      const otherSession = await createUserAndSession(USERS.LUIGI);

      const action = new WorkflowStepDelete();
      const connection = {
        session: { data: { userId: otherSession.user.id } },
      };

      await expect(
        action.run({ id: workflowId, stepId: step.id }, connection as any),
      ).rejects.toThrow("Workflow step not found or not owned by user");
    });
  });

  describe("WorkflowStepList", () => {
    it("should list workflow steps successfully", async () => {
      await createTestWorkflowStep(workflowId, agentId);
      await createTestWorkflowStep(workflowId, agentId);

      const action = new WorkflowStepList();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run({ id: workflowId }, connection as any);

      expect(result.steps).toBeDefined();
      expect(result.steps).toHaveLength(2);
    });

    it("should return empty array for workflow with no steps", async () => {
      const action = new WorkflowStepList();
      const connection = {
        session: { data: { userId } },
      };

      const result = await action.run({ id: workflowId }, connection as any);

      expect(result.steps).toBeDefined();
      expect(result.steps).toHaveLength(0);
    });

    it("should fail without a session", async () => {
      const action = new WorkflowStepList();
      const connection = { session: null };

      await expect(
        action.run({ id: workflowId }, connection as any),
      ).rejects.toThrow("User session not found");
    });

    it("should fail for non-existent workflow", async () => {
      const action = new WorkflowStepList();
      const connection = {
        session: { data: { userId } },
      };

      await expect(
        action.run({ id: 99999 }, connection as any),
      ).rejects.toThrow("Workflow not found or not owned by user");
    });

    it("should fail for another user's workflow", async () => {
      const otherSession = await createUserAndSession(USERS.LUIGI);
      const action = new WorkflowStepList();
      const connection = {
        session: { data: { userId: otherSession.user.id } },
      };

      await expect(
        action.run({ id: workflowId }, connection as any),
      ).rejects.toThrow("Workflow not found or not owned by user");
    });
  });
});
