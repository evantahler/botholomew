import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { Workflow, workflows } from "../models/workflow";
import { workflow_runs, WorkflowRun } from "../models/workflow_run";
import {
  workflow_run_steps,
  WorkflowRunStep,
} from "../models/workflow_run_step";
import {
  processWorkflowRunTick,
  serializeWorkflowRun,
} from "../ops/WorkflowRunOps";
import { serializeWorkflowRunStep } from "../ops/WorkflowRunStepOps";

export class WorkflowRunCreate implements Action {
  name = "workflow:run:create";
  description = "Create a new workflow run";
  web = { route: "/workflow/:id/run", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    input: z.string().describe("Input data for the workflow").nullable(),
  });

  async run(params: ActionParams<WorkflowRunCreate>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    const [workflow]: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, params.id), eq(workflows.userId, userId)))
      .limit(1);

    if (!workflow) {
      throw new TypedError({
        message: "Workflow not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    if (!workflow.enabled) {
      throw new TypedError({
        message: "Workflow is not enabled",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const [run]: WorkflowRun[] = await api.db.db
      .insert(workflow_runs)
      .values({
        workflowId: params.id,
        status: "pending",
        input: params.input,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })
      .returning();

    return { run: serializeWorkflowRun(run) };
  }
}

export class WorkflowRunView implements Action {
  name = "workflow:run:view";
  description = "View a workflow run";
  web = { route: "/workflow/:id/run/:runId", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    runId: z.coerce.number().int().describe("The run's id"),
  });

  async run(params: ActionParams<WorkflowRunView>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    const [run]: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(
        and(
          eq(workflow_runs.id, params.runId),
          eq(workflow_runs.workflowId, params.id),
        ),
      )
      .limit(1);

    if (!run) {
      throw new TypedError({
        message: "Workflow run not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const [workflow]: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.id, run.workflowId), eq(workflows.userId, userId)),
      )
      .limit(1);

    if (!workflow) {
      throw new TypedError({
        message: "Workflow run not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { run: serializeWorkflowRun(run) };
  }
}

export class WorkflowRunList implements Action {
  name = "workflow:run:list";
  description = "List workflow runs";
  web = { route: "/workflow/:id/runs", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<WorkflowRunList>, connection: Connection) {
    const { id, limit, offset } = params;
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    const [workflow]: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, userId)))
      .limit(1);

    if (!workflow) {
      throw new TypedError({
        message: "Workflow not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const runs: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, id))
      .orderBy(workflow_runs.createdAt)
      .limit(limit)
      .offset(offset);

    const [total] = await api.db.db
      .select({ count: count() })
      .from(workflow_runs)
      .where(eq(workflow_runs.workflowId, id));

    return { runs: runs.map(serializeWorkflowRun), total: total.count };
  }
}

export class WorkflowRunDelete implements Action {
  name = "workflow:run:delete";
  description = "Delete a workflow run";
  web = { route: "/workflow/:id/run/:runId", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    runId: z.coerce.number().int().describe("The run's id"),
  });

  async run(params: ActionParams<WorkflowRunDelete>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    const [workflowRun]: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(
        and(
          eq(workflow_runs.id, params.runId),
          eq(workflow_runs.workflowId, params.id),
        ),
      )
      .limit(1);

    if (!workflowRun) {
      throw new TypedError({
        message: "Workflow run not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    // Verify workflow ownership through the workflow run
    const [workflow]: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowRun.workflowId),
          eq(workflows.userId, userId),
        ),
      )
      .limit(1);

    if (!workflow) {
      throw new TypedError({
        message: "Workflow run not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const result = await api.db.db
      .delete(workflow_runs)
      .where(
        and(
          eq(workflow_runs.id, params.runId),
          eq(workflow_runs.workflowId, params.id),
        ),
      );

    return { success: result.rowCount > 0 };
  }
}

export class WorkflowRunTick implements Action {
  name = "workflow:run:tick";
  description = "Process the next step in a workflow run";
  web = { route: "/workflow/:id/run/:runId/tick", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    runId: z.coerce.number().int().describe("The run's id"),
  });

  async run(
    params: ActionParams<WorkflowRunTick>,
    connection: Connection,
  ): Promise<{
    workflowRun: ReturnType<typeof serializeWorkflowRun>;
  }> {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    return processWorkflowRunTick(params.id, params.runId, true, userId);
  }
}

export class WorkflowRunStepList implements Action {
  name = "workflow:run:step:list";
  description = "List workflow run steps for a specific workflow run";
  web = { route: "/workflow/:id/run/:runId/steps", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    runId: z.coerce.number().int().describe("The run's id"),
  });

  async run(params: ActionParams<WorkflowRunStepList>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // verify the workflow run exists and belongs to the user
    const [run]: WorkflowRun[] = await api.db.db
      .select()
      .from(workflow_runs)
      .where(
        and(
          eq(workflow_runs.id, params.runId),
          eq(workflow_runs.workflowId, params.id),
        ),
      )
      .limit(1);

    if (!run) {
      throw new TypedError({
        message: "Workflow run not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const [workflow]: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(
        and(eq(workflows.id, run.workflowId), eq(workflows.userId, userId)),
      )
      .limit(1);

    if (!workflow) {
      throw new TypedError({
        message: "Workflow run not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    // Get all steps for this workflow run
    const steps: WorkflowRunStep[] = await api.db.db
      .select()
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.workflowRunId, params.runId))
      .orderBy(workflow_run_steps.createdAt);

    return { steps: steps.map(serializeWorkflowRunStep) };
  }
}
