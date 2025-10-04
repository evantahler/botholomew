import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { agents } from "../models/agent";
import { Workflow, workflows } from "../models/workflow";
import { workflow_runs, WorkflowRun } from "../models/workflow_run";
import {
  workflow_run_steps,
  WorkflowRunStep,
} from "../models/workflow_run_step";
import { workflow_steps } from "../models/workflow_step";
import {
  processWorkflowRunTick,
  serializeWorkflowRun,
} from "../ops/WorkflowRunOps";
import { serializeWorkflowRunStep } from "../ops/WorkflowRunStepOps";

// Types for the database query result
type WorkflowRunWithDetails = {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  workflowId: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  input: string | null;
  output: Record<string, any> | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  currentStep: number;
  metadata: Record<string, any>;
  workflowName: string;
  workflowDescription: string | null;
  agentName: string | null;
  agentDescription: string | null;
};

// Type for the agent information in grouped runs
type AgentInfo = {
  name: string;
  description: string | null;
};

// Type for the final grouped run result
type GroupedWorkflowRun = ReturnType<typeof serializeWorkflowRun> & {
  createdAt: number;
  workflowName: string;
  workflowDescription: string | null;
  agents: AgentInfo[];
};

export class WorkflowRunListAll implements Action {
  name = "workflow:run:list:all";
  description = "List all workflow runs for a user across all their workflows";
  web = { route: "/workflows/runs", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<WorkflowRunListAll>, connection: Connection) {
    const { limit, offset } = params;
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Get all workflow runs for the user's workflows with workflow and agent information
    const runs: WorkflowRunWithDetails[] = await api.db.db
      .select({
        id: workflow_runs.id,
        createdAt: workflow_runs.createdAt,
        updatedAt: workflow_runs.updatedAt,
        workflowId: workflow_runs.workflowId,
        status: workflow_runs.status,
        input: workflow_runs.input,
        output: workflow_runs.output,
        error: workflow_runs.error,
        startedAt: workflow_runs.startedAt,
        completedAt: workflow_runs.completedAt,
        currentStep: workflow_runs.currentStep,
        metadata: workflow_runs.metadata,
        workflowName: workflows.name,
        workflowDescription: workflows.description,
        agentName: agents.name,
        agentDescription: agents.description,
      })
      .from(workflow_runs)
      .innerJoin(workflows, eq(workflow_runs.workflowId, workflows.id))
      .leftJoin(
        workflow_steps,
        eq(workflow_runs.workflowId, workflow_steps.workflowId),
      )
      .leftJoin(agents, eq(workflow_steps.agentId, agents.id))
      .where(eq(workflows.userId, userId))
      .orderBy(desc(workflow_runs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [total] = await api.db.db
      .select({ count: count() })
      .from(workflow_runs)
      .innerJoin(workflows, eq(workflow_runs.workflowId, workflows.id))
      .where(eq(workflows.userId, userId));

    // Group runs by workflow run ID to handle multiple agents per workflow
    const groupedRuns = runs.reduce(
      (
        acc: Record<number, GroupedWorkflowRun>,
        run: WorkflowRunWithDetails,
      ) => {
        if (!acc[run.id]) {
          acc[run.id] = {
            ...serializeWorkflowRun({
              id: run.id,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
              workflowId: run.workflowId,
              status: run.status,
              input: run.input,
              output: run.output,
              error: run.error,
              startedAt: run.startedAt,
              completedAt: run.completedAt,
              currentStep: run.currentStep,
              metadata: run.metadata,
            }),
            createdAt: run.createdAt.getTime(),
            workflowName: run.workflowName,
            workflowDescription: run.workflowDescription,
            agents: [],
          };
        }

        if (run.agentName) {
          acc[run.id].agents.push({
            name: run.agentName,
            description: run.agentDescription,
          });
        }

        return acc;
      },
      {} as Record<number, GroupedWorkflowRun>,
    );

    return {
      runs: Object.values(groupedRuns).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      total: total.count,
    } as {
      runs: GroupedWorkflowRun[];
      total: number;
    };
  }
}

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
      .orderBy(desc(workflow_runs.createdAt))
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

    return { success: (result.rowCount ?? 0) > 0 };
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
