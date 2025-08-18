import { type WorkflowRunStep } from "../models/workflow_run_step";

export function serializeWorkflowRunStep(run: WorkflowRunStep) {
  return {
    id: run.id,
    workflowRunId: run.workflowRunId,
    workflowStepId: run.workflowStepId,
    systemPrompt: run.systemPrompt,
    workflowId: run.workflowId,
    userMessage: run.userMessage,
    input: run.input,
    outout: run.outout,
    type: run.type,
    status: run.status,
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
  };
}
