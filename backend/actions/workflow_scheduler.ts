import { CronExpressionParser } from "cron-parser";
import { and, asc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { Action, api } from "../api";
import { DEFAULT_QUEUE } from "../classes/Action";
import { Workflow, workflows } from "../models/workflow";
import { workflow_runs } from "../models/workflow_run";

const WORKFLOWS_PER_RUN = 100;

export class WorkflowScheduler implements Action {
  name = "workflow:scheduler";
  description =
    "Check scheduled workflows and create runs for those due to execute";
  task = {
    frequency: 60000, // Run every minute
    queue: DEFAULT_QUEUE,
  };

  async run() {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    // Get enabled workflows with a schedule that haven't been scheduled in the last minute
    // Process oldest first, limited to WORKFLOWS_PER_RUN to avoid overwhelming the system
    const scheduledWorkflows: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.enabled, true),
          isNotNull(workflows.schedule),
          or(
            isNull(workflows.lastScheduledAt),
            lt(workflows.lastScheduledAt, oneMinuteAgo),
          ),
        ),
      )
      .orderBy(asc(workflows.lastScheduledAt))
      .limit(WORKFLOWS_PER_RUN);

    let createdRuns = 0;

    for (const workflow of scheduledWorkflows) {
      if (!workflow.schedule) continue;

      try {
        // Parse the cron expression
        const interval = CronExpressionParser.parse(workflow.schedule, {
          currentDate: workflow.lastScheduledAt ?? undefined,
        });

        // Get the next execution time
        const nextRun = interval.next().toDate();

        // If the next run time has passed, create a workflow run
        if (nextRun <= now) {
          // Check if we should run (i.e., we haven't already run for this schedule)
          const shouldRun =
            !workflow.lastScheduledAt || workflow.lastScheduledAt < nextRun;

          if (shouldRun) {
            // Create workflow run and update lastScheduledAt in a transaction
            await api.db.db.transaction(async (tx) => {
              await tx.insert(workflow_runs).values({
                workflowId: workflow.id,
                status: "pending",
              });

              await tx
                .update(workflows)
                .set({ lastScheduledAt: now })
                .where(eq(workflows.id, workflow.id));
            });

            createdRuns++;
          }
        }
      } catch (error) {
        // Invalid cron expression or parsing error - skip this workflow
        continue;
      }
    }

    return {
      success: true,
      scheduledWorkflowsChecked: scheduledWorkflows.length,
      runsCreated: createdRuns,
      checkedAt: now.getTime(),
    };
  }
}
