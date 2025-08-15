import { Workflow } from "../models/workflow";

export function serializeWorkflow(workflow: Workflow) {
  return {
    id: workflow.id,
    userId: workflow.userId,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    createdAt: workflow.createdAt.getTime(),
    updatedAt: workflow.updatedAt.getTime(),
  };
}
