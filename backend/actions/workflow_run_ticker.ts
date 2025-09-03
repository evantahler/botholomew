import { inArray } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, config } from "../api";
import { DEFAULT_QUEUE, HTTP_METHOD } from "../classes/Action";
import { workflow_runs, WorkflowRun } from "../models/workflow_run";

export class WorkflowRunTicker implements Action {
  name = "workflow:run:ticker";
  description =
    "Automatically enqueue WorkflowRunTick for all running workflows";
  task = {
    frequency: config.tasks.workflowTickerFrequency,
    queue: DEFAULT_QUEUE,
  };
  web = { route: "/workflow/run/ticker", method: HTTP_METHOD.POST };
  inputs = z.object({});

  async run(params: ActionParams<WorkflowRunTicker>) {
    const runningWorkflows: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(inArray(workflow_runs.status, ["running", "pending"]));

    let enqueuedCount = 0;

    for (const workflowRun of runningWorkflows) {
      const jobParams = {
        id: workflowRun.workflowId,
        runId: workflowRun.id,
      };

      await api.actions.enqueue("workflow:run:tick:system", jobParams);
      enqueuedCount++;
    }

    return {
      success: true,
      enqueuedCount,
      totalRunningWorkflows: runningWorkflows.length,
    };
  }
}
