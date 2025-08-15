import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { serializeWorkflow } from "../ops/WorkflowOps";
import { serializeWorkflowStep } from "../ops/WorkflowStepOps";
import { serializeWorkflowRun } from "../ops/WorkflowRunOps";
import { Workflow, workflows } from "../models/workflow";
import { workflow_steps, WorkflowStep } from "../models/workflow_step";
import { workflow_runs, WorkflowRun } from "../models/workflow_run";
import { SessionMiddleware } from "../middleware/session";
import { eq, and, count } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";
import { zBooleanFromString } from "../util/zodMixins";

export class WorkflowCreate implements Action {
  name = "workflow:create";
  description = "Create a new workflow";
  web = { route: "/workflow", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    name: z
      .string()
      .min(1, "Name is required and must be at least 1 character long")
      .max(256, "Name must be less than 256 characters")
      .describe("The workflow's name"),
    description: z.string().optional().describe("The workflow's description"),
    enabled: zBooleanFromString()
      .default(false)
      .describe("Whether the workflow is enabled"),
  });

  async run(params: ActionParams<WorkflowCreate>, connection: Connection) {
    const userId = connection.session!.data.userId;

    const [workflow]: Workflow[] = await api.db.db
      .insert(workflows)
      .values({
        userId,
        name: params.name,
        description: params.description,
        enabled: params.enabled,
      })
      .returning();

    return { workflow: serializeWorkflow(workflow) };
  }
}

export class WorkflowEdit implements Action {
  name = "workflow:edit";
  description = "Edit an existing workflow";
  web = { route: "/workflow/:id", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    name: z.string().min(1).max(256).optional(),
    description: z.string().optional(),
    enabled: zBooleanFromString().optional(),
  });

  async run(params: ActionParams<WorkflowEdit>, connection: Connection) {
    const userId = connection.session!.data.userId;

    const updates: Record<string, any> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined)
      updates.description = params.description;
    if (params.enabled !== undefined) updates.enabled = params.enabled;

    const [workflow]: Workflow[] = await api.db.db
      .update(workflows)
      .set(updates)
      .where(and(eq(workflows.id, params.id), eq(workflows.userId, userId)))
      .returning();

    if (!workflow) {
      throw new TypedError({
        message: "Workflow not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { workflow: serializeWorkflow(workflow) };
  }
}

export class WorkflowDelete implements Action {
  name = "workflow:delete";
  description = "Delete a workflow";
  web = { route: "/workflow/:id", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
  });

  async run(params: ActionParams<WorkflowDelete>, connection: Connection) {
    const userId = connection.session!.data.userId;

    const result = await api.db.db
      .delete(workflows)
      .where(and(eq(workflows.id, params.id), eq(workflows.userId, userId)));

    return { success: result.rowCount > 0 };
  }
}

export class WorkflowView implements Action {
  name = "workflow:view";
  description = "View a workflow";
  web = { route: "/workflow/:id", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
  });

  async run(params: ActionParams<WorkflowView>, connection: Connection) {
    const userId = connection.session!.data.userId;

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

    return { workflow: serializeWorkflow(workflow) };
  }
}

export class WorkflowList implements Action {
  name = "workflow:list";
  description = "List your workflows";
  web = { route: "/workflows", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<WorkflowList>, connection: Connection) {
    const { limit, offset } = params;
    const userId = connection.session!.data.userId;

    const rows: Workflow[] = await api.db.db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, userId))
      .limit(limit)
      .offset(offset);

    const [total]: { count: number }[] = await api.db.db
      .select({ count: count() })
      .from(workflows)
      .where(eq(workflows.userId, userId));

    return { workflows: rows.map(serializeWorkflow), total: total.count };
  }
}

export class WorkflowStepCreate implements Action {
  name = "workflow:step:create";
  description = "Create a new workflow step";
  web = { route: "/workflow/:id/step", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    agentId: z.coerce.number().int().optional().describe("The agent's id"),
    stepType: z
      .enum([
        "agent",
        "condition",
        "loop",
        "webhook",
        "delay",
        "manual",
        "timer",
      ])
      .describe("The type of step"),
    nextStepId: z.coerce
      .number()
      .int()
      .optional()
      .describe("The next step's id"),
  });

  async run(params: ActionParams<WorkflowStepCreate>, connection: Connection) {
    const userId = connection.session!.data.userId;

    // Verify workflow ownership
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

    const [step]: WorkflowStep[] = await api.db.db
      .insert(workflow_steps)
      .values({
        workflowId: params.id,
        agentId: params.agentId,
        stepType: params.stepType,
        nextStepId: params.nextStepId,
      })
      .returning();

    return { step: serializeWorkflowStep(step) };
  }
}

export class WorkflowStepEdit implements Action {
  name = "workflow:step:edit";
  description = "Edit an existing workflow step";
  web = { route: "/workflow/:id/step/:stepId", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    stepId: z.coerce.number().int().describe("The step's id"),
    agentId: z.coerce.number().int().optional(),
    stepType: z
      .enum([
        "agent",
        "condition",
        "loop",
        "webhook",
        "delay",
        "manual",
        "timer",
      ])
      .optional(),
    nextStepId: z.coerce.number().int().optional(),
  });

  async run(params: ActionParams<WorkflowStepEdit>, connection: Connection) {
    const userId = connection.session!.data.userId;

    // Verify step ownership through workflow
    const [step]: (WorkflowStep & { workflows: Workflow })[] = await api.db.db
      .select()
      .from(workflow_steps)
      .innerJoin(workflows, eq(workflow_steps.workflowId, workflows.id))
      .where(
        and(eq(workflow_steps.id, params.stepId), eq(workflows.userId, userId)),
      )
      .limit(1);

    if (!step) {
      throw new TypedError({
        message: "Workflow step not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const updates: Record<string, any> = {};
    if (params.agentId !== undefined) updates.agentId = params.agentId;
    if (params.stepType !== undefined) updates.stepType = params.stepType;
    if (params.nextStepId !== undefined) updates.nextStepId = params.nextStepId;

    const [updatedStep]: WorkflowStep[] = await api.db.db
      .update(workflow_steps)
      .set(updates)
      .where(eq(workflow_steps.id, params.id))
      .returning();

    return { step: serializeWorkflowStep(updatedStep) };
  }
}

export class WorkflowStepDelete implements Action {
  name = "workflow:step:delete";
  description = "Delete a workflow step";
  web = { route: "/workflow/:id/step/:stepId", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    stepId: z.coerce.number().int().describe("The step's id"),
  });

  async run(params: ActionParams<WorkflowStepDelete>, connection: Connection) {
    const userId = connection.session!.data.userId;

    // Verify step ownership through workflow
    const [step] = await api.db.db
      .select()
      .from(workflow_steps)
      .innerJoin(workflows, eq(workflow_steps.workflowId, workflows.id))
      .where(
        and(eq(workflow_steps.id, params.stepId), eq(workflows.userId, userId)),
      )
      .limit(1);

    if (!step) {
      throw new TypedError({
        message: "Workflow step not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const result = await api.db.db
      .delete(workflow_steps)
      .where(eq(workflow_steps.id, params.stepId));

    return { success: result.rowCount > 0 };
  }
}

export class WorkflowStepList implements Action {
  name = "workflow:step:list";
  description = "List workflow steps";
  web = { route: "/workflow/:id/steps", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
  });

  async run(params: ActionParams<WorkflowStepList>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify workflow ownership
    const [workflow] = await api.db.db
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

    const steps: WorkflowStep[] = await api.db.db
      .select()
      .from(workflow_steps)
      .where(eq(workflow_steps.workflowId, params.id));

    return { steps: steps.map(serializeWorkflowStep) };
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

    // Verify workflow ownership
    const [workflow] = await api.db.db
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

    const [run] = await api.db.db
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
  web = { route: "/workflow/run/:id", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The run's id"),
  });

  async run(params: ActionParams<WorkflowRunView>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    const [run] = await api.db.db
      .select()
      .from(workflow_runs)
      .innerJoin(workflows, eq(workflow_runs.workflowId, workflows.id))
      .where(and(eq(workflow_runs.id, params.id), eq(workflows.userId, userId)))
      .limit(1);

    if (!run) {
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

    // Verify workflow ownership
    const [workflow] = await api.db.db
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
