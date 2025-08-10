import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { agents } from "../models/agent";
import { SessionMiddleware } from "../middleware/session";
import { eq, and, sql, desc } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";
import { agent_run } from "../models/agent_run";
import { serializeAgentRun } from "../ops/AgentRunOps";

export class AgentRunDelete implements Action {
  name = "agentRun:delete";
  description = "Delete an agent run";
  web = { route: "/agentRun", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent run's id"),
  });

  async run(params: ActionParams<AgentRunDelete>, connection: Connection) {
    // First check if the message belongs to an agent owned by the user
    const [agentRun] = await api.db.db
      .select({ id: agent_run.id })
      .from(agent_run)
      .innerJoin(agents, eq(agent_run.agentId, agents.id))
      .where(
        and(
          eq(agent_run.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!agentRun) {
      return { success: false };
    }

    // Delete the agent run
    const result = await api.db.db
      .delete(agent_run)
      .where(eq(agent_run.id, params.id));

    return { success: (result.rowCount ?? 0) > 0 };
  }
}

export class AgentRunView implements Action {
  name = "agentRun:view";
  description = "View an agent run";
  web = { route: "/agentRun/:id", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent run's id"),
  });

  async run(params: ActionParams<AgentRunView>, connection: Connection) {
    // First verify the agent belongs to the user
    const [agent] = await api.db.db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(agent_run, eq(agents.id, agent_run.agentId))
      .where(
        and(
          eq(agent_run.id, params.id),
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
    const [agentRun] = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.id, params.id))
      .limit(1);

    if (!agentRun) {
      throw new TypedError({
        message: "Agent run not found",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    return { agentRun: serializeAgentRun(agentRun) };
  }
}

export class AgentRunList implements Action {
  name = "agentRun:list";
  description = "List agent runs for an agent";
  web = { route: "/agentRuns", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    agentId: z.coerce.number().int().describe("The agent's id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<AgentRunList>, connection: Connection) {
    const { agentId, limit, offset } = params;
    const userId = connection.session?.data.userId;

    // Verify the agent belongs to the user
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
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
      .from(agent_run)
      .where(eq(agent_run.agentId, agentId));

    const rows = await api.db.db
      .select()
      .from(agent_run)
      .where(eq(agent_run.agentId, agentId))
      .orderBy(desc(agent_run.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      agentRuns: rows.map(serializeAgentRun),
      total: Number(count),
    };
  }
}
