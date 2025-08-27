import { WorkflowRunStep } from "../models/workflow_run_step";

export function serializeWorkflowRunStep(workflowRunStep: WorkflowRunStep) {
  return {
    id: workflowRunStep.id,
    workflowRunId: workflowRunStep.workflowRunId,
    workflowStepId: workflowRunStep.workflowStepId,
    workflowId: workflowRunStep.workflowId,
    systemPrompt: workflowRunStep.systemPrompt,
    userPrompt: workflowRunStep.userPrompt,
    input: workflowRunStep.input,
    output: workflowRunStep.output,
    responseType: workflowRunStep.responseType,
    status: workflowRunStep.status,
    createdAt: workflowRunStep.createdAt.getTime(),
    updatedAt: workflowRunStep.updatedAt.getTime(),
  };
}
