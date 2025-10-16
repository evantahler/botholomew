import { WorkflowStep } from "../models/workflow_step";

export type ConditionResult = {
    result: boolean;
    nextStepPosition?: number;
    shouldExit?: boolean;
};

/**
 * Evaluates a conditional step based on the previous step's output
 * @param step - The conditional workflow step
 * @param previousOutput - The output from the previous step
 * @returns The result of the condition evaluation and next step position
 */
export function evaluateCondition(
    step: WorkflowStep,
    previousOutput: string | null,
): ConditionResult {
    if (step.stepType !== "condition" && step.stepType !== "early-exit") {
        throw new Error("Step is not a conditional or early-exit step");
    }

    if (!previousOutput) {
        // If no previous output, follow the false branch if it exists, otherwise continue to next step
        return {
            result: false,
            nextStepPosition: step.branches.false ?? step.position + 1,
        };
    }

    let conditionResult = false;

    switch (step.conditionType) {
        case "output_contains":
            if (!step.conditionValue) {
                throw new Error("Condition value is required for output_contains");
            }
            conditionResult = previousOutput
                .toLowerCase()
                .includes(step.conditionValue.toLowerCase());
            break;

        case "output_equals":
            if (!step.conditionValue) {
                throw new Error("Condition value is required for output_equals");
            }
            conditionResult = previousOutput.trim() === step.conditionValue.trim();
            break;

        case "output_matches":
            if (!step.conditionValue) {
                throw new Error("Condition value is required for output_matches");
            }
            try {
                const regex = new RegExp(step.conditionValue, "i");
                conditionResult = regex.test(previousOutput);
            } catch (error) {
                throw new Error(`Invalid regex pattern: ${error}`);
            }
            break;

        default:
            throw new Error(`Unknown condition type: ${step.conditionType}`);
    }

    // Handle early-exit steps
    if (step.stepType === "early-exit") {
        return {
            result: conditionResult,
            shouldExit: conditionResult, // Exit if condition is true
            nextStepPosition: step.position + 1, // Default to next step if not exiting
        };
    }

    // Handle regular conditional steps
    if (!step.branches) {
        throw new Error("Conditional step must have branches configured");
    }

    const nextStepPosition = conditionResult
        ? (step.branches.true ?? step.position + 1)
        : (step.branches.false ?? step.position + 1);

    return {
        result: conditionResult,
        nextStepPosition,
    };
}
