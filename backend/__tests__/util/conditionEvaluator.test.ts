import { describe, expect, it } from "bun:test";
import { WorkflowStep } from "../../models/workflow_step";
import { evaluateCondition } from "../../util/conditionEvaluator";

describe("ConditionEvaluator", () => {
    describe("evaluateCondition", () => {
        it("should evaluate output_contains condition correctly", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_contains",
                conditionValue: "success",
                conditionExpression: null,
                branches: {
                    true: 3,
                    false: 2,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "The operation was successful");
            expect(result.result).toBe(true);
            expect(result.nextStepPosition).toBe(3);
        });

        it("should evaluate output_contains condition as false when text not found", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_contains",
                conditionValue: "error",
                conditionExpression: null,
                branches: {
                    true: 3,
                    false: 2,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "The operation was successful");
            expect(result.result).toBe(false);
            expect(result.nextStepPosition).toBe(2);
        });

        it("should evaluate output_equals condition correctly", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_equals",
                conditionValue: "yes",
                conditionExpression: null,
                branches: {
                    true: 4,
                    false: 5,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "yes");
            expect(result.result).toBe(true);
            expect(result.nextStepPosition).toBe(4);
        });

        it("should evaluate output_equals condition as false when not equal", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_equals",
                conditionValue: "yes",
                conditionExpression: null,
                branches: {
                    true: 4,
                    false: 5,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "no");
            expect(result.result).toBe(false);
            expect(result.nextStepPosition).toBe(5);
        });

        it("should evaluate output_matches condition with regex", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_matches",
                conditionValue: "\\d+",
                conditionExpression: null,
                branches: {
                    true: 6,
                    false: 7,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "The number is 123");
            expect(result.result).toBe(true);
            expect(result.nextStepPosition).toBe(6);
        });

        it("should evaluate output_matches condition as false when regex doesn't match", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_matches",
                conditionValue: "\\d+",
                conditionExpression: null,
                branches: {
                    true: 6,
                    false: 7,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "No numbers here");
            expect(result.result).toBe(false);
            expect(result.nextStepPosition).toBe(7);
        });

        it("should handle null previous output", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_contains",
                conditionValue: "test",
                conditionExpression: null,
                branches: {
                    true: 3,
                    false: 2,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, null);
            expect(result.result).toBe(false);
            expect(result.nextStepPosition).toBe(2);
        });

        it("should use next step position when no branches are defined", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_contains",
                conditionValue: "test",
                conditionExpression: null,
                branches: {},
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "test");
            expect(result.result).toBe(true);
            expect(result.nextStepPosition).toBe(2); // position + 1
        });

        it("should throw error for non-conditional step", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "agent",
                conditionType: null,
                conditionValue: null,
                conditionExpression: null,
                branches: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            expect(() => evaluateCondition(step, "test")).toThrow(
                "Step is not a conditional or early-exit step",
            );
        });

        it("should throw error for missing condition value", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_contains",
                conditionValue: null,
                conditionExpression: null,
                branches: {
                    true: 3,
                    false: 2,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            expect(() => evaluateCondition(step, "test")).toThrow(
                "Condition value is required for output_contains",
            );
        });

        it("should throw error for invalid regex", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: 1,
                position: 1,
                stepType: "condition",
                conditionType: "output_matches",
                conditionValue: "[invalid",
                conditionExpression: null,
                branches: {
                    true: 3,
                    false: 2,
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            expect(() => evaluateCondition(step, "test")).toThrow(
                "Invalid regex pattern",
            );
        });

        it("should evaluate early-exit step correctly", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: null,
                position: 1,
                stepType: "early-exit",
                conditionType: "output_contains",
                conditionValue: "error",
                conditionExpression: null,
                branches: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "An error occurred");
            expect(result.result).toBe(true);
            expect(result.shouldExit).toBe(true);
            expect(result.nextStepPosition).toBe(2);
        });

        it("should not exit early-exit step when condition is false", () => {
            const step: WorkflowStep = {
                id: 1,
                workflowId: 1,
                agentId: null,
                position: 1,
                stepType: "early-exit",
                conditionType: "output_contains",
                conditionValue: "error",
                conditionExpression: null,
                branches: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = evaluateCondition(step, "Success message");
            expect(result.result).toBe(false);
            expect(result.shouldExit).toBe(false);
            expect(result.nextStepPosition).toBe(2);
        });
    });
});
