import { WorkflowRun } from "../models/workflow_run";

export function serializeWorkflowRun(workflowRun: WorkflowRun) {
  return {
    id: workflowRun.id,
    workflowId: workflowRun.workflowId,
    status: workflowRun.status,
    input: workflowRun.input,
    output: workflowRun.output,
    error: workflowRun.error,
    startedAt: workflowRun.startedAt?.getTime(),
    completedAt: workflowRun.completedAt?.getTime(),
    metadata: workflowRun.metadata,
  };
}
