import { describe, expect, it } from "bun:test";
import { WorkflowRun } from "../../models/workflow_run";
import { serializeWorkflowRun } from "../../ops/WorkflowRunOps";

describe("WorkflowRunOps", () => {
  describe("serializeWorkflowRun", () => {
    it("should serialize workflow run correctly", () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 10000);
      const completedAt = new Date(now.getTime());

      const mockWorkflowRun: WorkflowRun = {
        id: 123,
        workflowId: 456,
        status: "completed",
        input: "Test input",
        output: "Test output",
        error: null,
        currentStep: 3,
        startedAt,
        completedAt,
        metadata: { key: "value" },
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflowRun(mockWorkflowRun);

      expect(serialized).toEqual({
        id: 123,
        workflowId: 456,
        status: "completed",
        input: "Test input",
        output: "Test output",
        error: null,
        currentStep: 3,
        startedAt: startedAt.getTime(),
        completedAt: completedAt.getTime(),
        metadata: { key: "value" },
      });
    });

    it("should handle pending workflow run", () => {
      const mockWorkflowRun: WorkflowRun = {
        id: 1,
        workflowId: 2,
        status: "pending",
        input: "Initial input",
        output: null,
        error: null,
        currentStep: 0,
        startedAt: null,
        completedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflowRun(mockWorkflowRun);

      expect(serialized.status).toBe("pending");
      expect(serialized.startedAt).toBeUndefined();
      expect(serialized.completedAt).toBeUndefined();
      expect(serialized.output).toBe(null);
    });

    it("should handle failed workflow run", () => {
      const mockWorkflowRun: WorkflowRun = {
        id: 10,
        workflowId: 20,
        status: "failed",
        input: "Test input",
        output: null,
        error: "Something went wrong",
        currentStep: 1,
        startedAt: new Date(),
        completedAt: new Date(),
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflowRun(mockWorkflowRun);

      expect(serialized.status).toBe("failed");
      expect(serialized.error).toBe("Something went wrong");
    });

    it("should handle running workflow run", () => {
      const mockWorkflowRun: WorkflowRun = {
        id: 100,
        workflowId: 200,
        status: "running",
        input: "Running input",
        output: null,
        error: null,
        currentStep: 2,
        startedAt: new Date(),
        completedAt: null,
        metadata: { currentPosition: 2 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflowRun(mockWorkflowRun);

      expect(serialized.status).toBe("running");
      expect(serialized.startedAt).toBeDefined();
      expect(serialized.completedAt).toBeUndefined();
    });
  });
});
