import { WorkflowStep } from "../models/workflow_step";

export function serializeWorkflowStep(workflowStep: WorkflowStep) {
  return {
    id: workflowStep.id,
    workflowId: workflowStep.workflowId,
    agentId: workflowStep.agentId,
    stepType: workflowStep.stepType,
    position: workflowStep.position,
    createdAt: workflowStep.createdAt.getTime(),
    updatedAt: workflowStep.updatedAt.getTime(),
  };
}
