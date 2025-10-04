import { Workflow } from "../models/workflow";

export function serializeWorkflow(workflow: Workflow) {
  return {
    id: workflow.id,
    userId: workflow.userId,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    schedule: workflow.schedule,
    lastScheduledAt: workflow.lastScheduledAt?.getTime() ?? null,
    createdAt: workflow.createdAt.getTime(),
    updatedAt: workflow.updatedAt.getTime(),
  };
}
