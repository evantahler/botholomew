import { type WorkflowRunStep } from "../models/workflow_run_step";

export function serializeWorkflowRunStep(run: WorkflowRunStep) {
  return {
    id: run.id,
    workflowRunId: run.workflowRunId,
    workflowStepId: run.workflowStepId,
    systemPrompt: run.systemPrompt,
    workflowId: run.workflowId,
    userPrompt: run.userPrompt,
    input: run.input,
    output: run.output,
    responseType: run.responseType,
    status: run.status,
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
  };
}
