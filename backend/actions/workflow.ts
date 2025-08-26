import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { Workflow, workflows } from "../models/workflow";
import { serializeWorkflow } from "../ops/WorkflowOps";
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
