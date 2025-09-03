import { z } from "zod";
import { Action, type ActionParams } from "../api";
import { DEFAULT_QUEUE, HTTP_METHOD } from "../classes/Action";
import {
  processWorkflowRunTick,
  serializeWorkflowRun,
} from "../ops/WorkflowRunOps";

export class WorkflowRunTickSystem implements Action {
  name = "workflow:run:tick:system";
  description =
    "Process the next step in a workflow run (system-level, no auth required)";
  task = { queue: DEFAULT_QUEUE };
  web = {
    route: "/system/workflow/:id/run/:runId/tick",
    method: HTTP_METHOD.POST,
  };
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    runId: z.coerce.number().int().describe("The run's id"),
  });

  async run(params: ActionParams<WorkflowRunTickSystem>): Promise<{
    workflowRun: ReturnType<typeof serializeWorkflowRun>;
  }> {
    return processWorkflowRunTick(params.id, params.runId, false);
  }
}
