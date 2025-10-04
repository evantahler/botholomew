import { describe, expect, it } from "bun:test";
import { WorkflowStep } from "../../models/workflow_step";
import { serializeWorkflowStep } from "../../ops/WorkflowStepOps";

describe("WorkflowStepOps", () => {
  describe("serializeWorkflowStep", () => {
    it("should serialize workflow step correctly", () => {
      const now = new Date();

      const mockStep: WorkflowStep = {
        id: 123,
        workflowId: 456,
        agentId: 789,
        position: 1,
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflowStep(mockStep);

      expect(serialized).toEqual({
        id: 123,
        workflowId: 456,
        agentId: 789,
        position: 1,
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
    });

    it("should handle null agentId", () => {
      const now = new Date();

      const mockStep: WorkflowStep = {
        id: 111,
        workflowId: 222,
        agentId: null,
        position: 2,
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflowStep(mockStep);

      expect(serialized.agentId).toBe(null);
    });

    it("should correctly serialize different positions", () => {
      const step1: WorkflowStep = {
        id: 1,
        workflowId: 100,
        agentId: 200,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const step2: WorkflowStep = {
        id: 2,
        workflowId: 100,
        agentId: 201,
        position: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(serializeWorkflowStep(step1).position).toBe(0);
      expect(serializeWorkflowStep(step2).position).toBe(5);
    });
  });
});
