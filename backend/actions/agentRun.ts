import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { Agent, agents } from "../models/agent";
import { workflows } from "../models/workflow";
import {
  workflow_run_steps,
  WorkflowRunStep,
} from "../models/workflow_run_step";
import { workflow_steps } from "../models/workflow_step";
import { agentTick } from "../ops/AgentOps";
import { serializeWorkflowRunStep } from "../ops/AgentRunOps";

export class AgentRunDelete implements Action {
  name = "agentRun:delete";
  description = "Delete an agent run";
  web = { route: "/agent/:id/run/:runId", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    runId: z.coerce.number().int().describe("The agent run's id"),
  });

  async run(params: ActionParams<AgentRunDelete>, connection: Connection) {
    // First check if the message belongs to an agent owned by the user
    const [agentRun] = await api.db.db
      .select({ id: workflow_run_steps.id })
      .from(workflow_run_steps)
      .innerJoin(agents, eq(workflow_run_steps.workflowId, agents.id))
      .innerJoin(workflows, eq(workflow_run_steps.workflowId, workflows.id))
      .where(
        and(
          eq(workflow_run_steps.workflowId, params.id),
          eq(workflow_run_steps.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!agentRun) {
      return { success: false };
    }

    // Delete the agent run
    const result = await api.db.db
      .delete(workflow_run_steps)
      .where(eq(workflow_run_steps.id, params.id));

    return { success: (result.rowCount ?? 0) > 0 };
  }
}

export class AgentRunView implements Action {
  name = "agentRun:view";
  description = "View an agent run";
  web = { route: "/agent/:id/run/:runId", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    runId: z.coerce.number().int().describe("The agent run's id"),
  });

  async run(params: ActionParams<AgentRunView>, connection: Connection) {
    // First verify the agent belongs to the user
    const [agent] = await api.db.db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(
        workflow_run_steps,
        eq(agents.id, workflow_run_steps.workflowId),
      )
      .where(
        and(
          eq(workflow_run_steps.workflowId, params.id),
          eq(workflow_run_steps.id, params.runId),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent run not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    // Then get the agent run data
    const [workflowRunStep] = await api.db.db
      .select()
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.id, params.id))
      .limit(1);

    if (!workflowRunStep) {
      throw new TypedError({
        message: "Agent run not found",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    return { agentRun: serializeWorkflowRunStep(workflowRunStep) };
  }
}

export class AgentRunList implements Action {
  name = "agentRun:list";
  description = "List agent runs for an agent";
  web = { route: "/agent/:id/runs", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<AgentRunList>, connection: Connection) {
    const { id, limit, offset } = params;
    const userId = connection.session?.data.userId;

    // Verify the agent belongs to the user
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, userId)))
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    // Get total count
    const [{ count }] = await api.db.db
      .select({ count: sql<number>`count(*)` })
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.workflowId, id));

    const rows: WorkflowRunStep[] = await api.db.db
      .select()
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.workflowId, id))
      .orderBy(desc(workflow_run_steps.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      agentRuns: rows.map(serializeWorkflowRunStep),
      total: Number(count),
    };
  }
}

export class AgentRunRun implements Action {
  name = "agentRun:run";
  description = "Run an agent run";
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent run's id"),
  });

  async run(params: ActionParams<AgentRunRun>) {
    const { id } = params;

    const [workflowRunStep]: WorkflowRunStep[] = await api.db.db
      .select()
      .from(workflow_run_steps)
      .where(eq(workflow_run_steps.id, id));

    if (!workflowRunStep) {
      throw new TypedError({
        message: "Agent run not found",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    if (workflowRunStep.status !== "pending") {
      throw new TypedError({
        message: "Agent run is not pending",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    const [agent]: Agent[] = await api.db.db
      .select()
      .from(agents)
      .innerJoin(workflow_steps, eq(agents.id, workflow_steps.agentId))
      .where(eq(agents.id, workflowRunStep.workflowStepId))
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    if (agent.enabled !== true) {
      throw new TypedError({
        message: "Agent is not enabled",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    const result = await agentTick(agent, workflowRunStep);
    return { agentRun: serializeWorkflowRunStep(result) };
  }
}
