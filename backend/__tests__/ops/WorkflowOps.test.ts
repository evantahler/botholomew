import { describe, expect, it } from "bun:test";
import { Workflow } from "../../models/workflow";
import { serializeWorkflow } from "../../ops/WorkflowOps";

describe("WorkflowOps", () => {
  describe("serializeWorkflow", () => {
    it("should serialize workflow correctly", () => {
      const now = new Date();
      const lastScheduled = new Date(now.getTime() - 3600000);

      const mockWorkflow: Workflow = {
        id: 123,
        userId: 456,
        name: "Test Workflow",
        description: "A test workflow",
        enabled: true,
        schedule: "0 0 * * *",
        lastScheduledAt: lastScheduled,
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflow(mockWorkflow);

      expect(serialized).toEqual({
        id: 123,
        userId: 456,
        name: "Test Workflow",
        description: "A test workflow",
        enabled: true,
        schedule: "0 0 * * *",
        lastScheduledAt: lastScheduled.getTime(),
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
    });

    it("should handle null lastScheduledAt", () => {
      const now = new Date();

      const mockWorkflow: Workflow = {
        id: 789,
        userId: 101,
        name: "New Workflow",
        description: "Never scheduled",
        enabled: false,
        schedule: null,
        lastScheduledAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const serialized = serializeWorkflow(mockWorkflow);

      expect(serialized.lastScheduledAt).toBe(null);
    });

    it("should handle disabled workflow", () => {
      const mockWorkflow: Workflow = {
        id: 1,
        userId: 2,
        name: "Disabled Workflow",
        description: "This workflow is disabled",
        enabled: false,
        schedule: null,
        lastScheduledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const serialized = serializeWorkflow(mockWorkflow);

      expect(serialized.enabled).toBe(false);
    });
  });
});
