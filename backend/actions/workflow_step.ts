import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { Workflow, workflows } from "../models/workflow";
import { workflow_steps, WorkflowStep } from "../models/workflow_step";
import { serializeWorkflowStep } from "../ops/WorkflowStepOps";

export class WorkflowStepCreate implements Action {
  name = "workflow:step:create";
  description = "Create a new workflow step";
  web = { route: "/workflow/:id/step", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The workflow's id"),
    agentId: z.coerce.number().int().optional().describe("The agent's id"),
    position: z.coerce.number().int().describe("The step's position"),
    stepType: z
      .enum(["agent", "condition", "early-exit"])
      .default("agent")
      .describe("The type of step"),
    conditionType: z
      .enum(["output_contains", "output_equals", "output_matches"])
      .optional()
      .describe("The type of condition for conditional steps"),
    conditionValue: z
      .string()
      .max(1000)
      .optional()
      .describe("The value to compare against for conditions"),
    branches: z
      .union([
        z.string().transform((str, ctx) => {
          try {
            return JSON.parse(str);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid JSON string for branches",
            });
            return z.NEVER;
          }
        }),
        z.object({
          true: z
            .number()
            .int()
            .optional()
            .describe("Next step position if condition is true"),
          false: z
            .number()
            .int()
            .optional()
            .describe("Next step position if condition is false"),
        }),
      ])
      .optional()
      .describe("Branching configuration for conditional steps"),
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
        agentId: params.agentId || null,
        position: params.position,
        stepType: params.stepType,
        conditionType: params.conditionType,
        conditionValue: params.conditionValue,
        branches: params.branches,
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
    position: z.coerce.number().int().optional(),
    stepType: z.enum(["agent", "condition", "early-exit"]).optional(),
    conditionType: z
      .enum(["output_contains", "output_equals", "output_matches"])
      .optional(),
    conditionValue: z.string().max(1000).optional(),
    branches: z
      .union([
        z.string().transform((str, ctx) => {
          try {
            return JSON.parse(str);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid JSON string for branches",
            });
            return z.NEVER;
          }
        }),
        z.object({
          true: z.number().int().optional(),
          false: z.number().int().optional(),
        }),
      ])
      .optional(),
  });

  async run(params: ActionParams<WorkflowStepEdit>, connection: Connection) {
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

    const updates: Record<string, any> = {};
    if (params.agentId !== undefined) updates.agentId = params.agentId;
    if (params.position !== undefined) updates.position = params.position;
    if (params.stepType !== undefined) updates.stepType = params.stepType;
    if (params.conditionType !== undefined)
      updates.conditionType = params.conditionType;
    if (params.conditionValue !== undefined)
      updates.conditionValue = params.conditionValue;
    if (params.branches !== undefined) updates.branches = params.branches;

    const [updatedStep]: WorkflowStep[] = await api.db.db
      .update(workflow_steps)
      .set(updates)
      .where(eq(workflow_steps.id, params.stepId))
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

    return { success: (result.rowCount ?? 0) > 0 };
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
