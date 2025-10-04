import { describe, expect, it } from "bun:test";
import { WorkflowRunStep } from "../../models/workflow_run_step";
import { serializeWorkflowRunStep } from "../../ops/WorkflowRunStepOps";

describe("WorkflowRunStepOps", () => {
  describe("serializeWorkflowRunStep", () => {
    it("should serialize workflow run step correctly", () => {
      const now = new Date();

      const mockStep: WorkflowRunStep = {
        id: 123,
        workflowRunId: 456,
        workflowStepId: 789,
        workflowId: 111,
        systemPrompt: "Test system prompt",
        userPrompt: "Test user prompt",
        input: "Test input",
        output: "Test output",
        responseType: "text",
        rationale: "Test rationale",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflowRunStep(mockStep);

      expect(serialized).toEqual({
        id: 123,
        workflowRunId: 456,
        workflowStepId: 789,
        workflowId: 111,
        systemPrompt: "Test system prompt",
        userPrompt: "Test user prompt",
        input: "Test input",
        output: "Test output",
        responseType: "text",
        rationale: "Test rationale",
        status: "completed",
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
    });

    it("should handle pending step", () => {
      const mockStep: WorkflowRunStep = {
        id: 1,
        workflowRunId: 2,
        workflowStepId: 3,
        workflowId: 4,
        systemPrompt: "System",
        userPrompt: "User",
        input: "Input",
        output: null,
        responseType: "json",
        rationale: null,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflowRunStep(mockStep);

      expect(serialized.status).toBe("pending");
      expect(serialized.output).toBe(null);
      expect(serialized.rationale).toBe(null);
    });

    it("should handle different response types", () => {
      const textStep: WorkflowRunStep = {
        id: 10,
        workflowRunId: 20,
        workflowStepId: 30,
        workflowId: 40,
        systemPrompt: "System",
        userPrompt: "User",
        input: "Input",
        output: "Text output",
        responseType: "text",
        rationale: null,
        status: "completed",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const jsonStep: WorkflowRunStep = {
        ...textStep,
        id: 11,
        responseType: "json",
        output: '{"key": "value"}',
      };

      const markdownStep: WorkflowRunStep = {
        ...textStep,
        id: 12,
        responseType: "markdown",
        output: "# Markdown",
      };

      expect(serializeWorkflowRunStep(textStep).responseType).toBe("text");
      expect(serializeWorkflowRunStep(jsonStep).responseType).toBe("json");
      expect(serializeWorkflowRunStep(markdownStep).responseType).toBe(
        "markdown",
      );
    });

    it("should handle failed step", () => {
      const mockStep: WorkflowRunStep = {
        id: 100,
        workflowRunId: 200,
        workflowStepId: 300,
        workflowId: 400,
        systemPrompt: "System",
        userPrompt: "User",
        input: "Input",
        output: "Error occurred",
        responseType: "text",
        rationale: "Failed rationale",
        status: "failed",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflowRunStep(mockStep);

      expect(serialized.status).toBe("failed");
      expect(serialized.rationale).toBe("Failed rationale");
    });
  });
});
