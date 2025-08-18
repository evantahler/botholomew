import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { serializeAgent, getSystemPrompt } from "../ops/AgentOps";
import { Agent, agents, responseTypes } from "../models/agent";
import { SessionMiddleware } from "../middleware/session";
import { eq, and, count } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";
import { serializeAgentRun } from "../ops/AgentRunOps";
import { zBooleanFromString } from "../util/zodMixins";
import { getUnauthorizedToolkits } from "../ops/ToolkitAuthorizationOps";
import { agent_run, AgentRun } from "../models/workflow_run_step";

export class AgentModels implements Action {
  name = "agent:models";
  description = "Get available agent models";
  web = { route: "/agent/models", method: HTTP_METHOD.GET };

  async run() {
    return { models: api.openai.getAvailableModels() };
  }
}

export class AgentCreate implements Action {
  name = "agent:create";
  description = "Create a new agent";
  web = { route: "/agent", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    name: z
      .string()
      .min(1, "Name is required and must be at least 1 character long")
      .max(256, "Name must be less than 256 characters")
      .describe("The agent's name"),
    description: z.string().optional().describe("The agent's description"),
    model: z
      .string()
      .min(1, "Model is required")
      .max(256, "Model must be less than 256 characters")
      .describe("The AI model to use for this agent"),

    userPrompt: z
      .string()
      .min(1, "User prompt is required")
      .describe("The user prompt for the agent"),
    responseType: z.enum(responseTypes.enumValues).default("text"),
    enabled: zBooleanFromString()
      .default(false)
      .describe("Whether the agent is enabled"),
    schedule: z
      .string()
      .optional()
      .describe("Cron schedule for the agent (if applicable)"),
    toolkits: z
      .union([
        z.array(z.string()),
        z.string().transform((val) => {
          if (val === "") return [];
          return [val];
        }),
      ])
      .default([])
      .describe("Array of arcade toolkit names to enable for this agent"),
  });

  async run(params: ActionParams<AgentCreate>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    if (params.toolkits && params.toolkits.length > 0) {
      const unauthorizedToolkits = await getUnauthorizedToolkits(
        userId,
        params.toolkits,
      );

      if (unauthorizedToolkits.length > 0) {
        throw new TypedError({
          message: `You are not authorized to use the following toolkits: ${unauthorizedToolkits.join(", ")}. Please authorize these toolkits before creating an agent with them.`,
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        });
      }
    }

    const [agent]: Agent[] = await api.db.db
      .insert(agents)
      .values({
        userId,
        name: params.name,
        description: params.description,
        model: params.model,
        systemPrompt: "",
        userPrompt: params.userPrompt,
        responseType: params.responseType,
        enabled: params.enabled,
        schedule: params.schedule,
        toolkits: params.toolkits,
      })
      .returning();

    const systemPrompt = getSystemPrompt(agent);
    const [updatedAgent]: Agent[] = await api.db.db
      .update(agents)
      .set({ systemPrompt })
      .where(eq(agents.id, agent.id))
      .returning();

    return { agent: serializeAgent(updatedAgent) };
  }
}

export class AgentEdit implements Action {
  name = "agent:edit";
  description = "Edit an existing agent";
  web = { route: "/agent/:id", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    name: z.string().min(1).max(256).optional(),
    description: z.string().optional(),
    model: z.string().min(1).max(256).optional(),
    userPrompt: z.string().optional(),
    responseType: z.enum(responseTypes.enumValues).optional(),
    enabled: zBooleanFromString().optional(),
    schedule: z.string().optional(),
    toolkits: z
      .union([
        z.array(z.string()),
        z.string().transform((val) => {
          if (val === "") return [];
          return [val];
        }),
      ])
      .optional(),
  });

  async run(params: ActionParams<AgentEdit>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    if (params.toolkits !== undefined && params.toolkits.length > 0) {
      const unauthorizedToolkits = await getUnauthorizedToolkits(
        userId,
        params.toolkits,
      );

      if (unauthorizedToolkits.length > 0) {
        throw new TypedError({
          message: `You are not authorized to use the following toolkits: ${unauthorizedToolkits.join(", ")}. Please authorize these toolkits before adding them to your agent.`,
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        });
      }
    }

    const updates: Record<string, any> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined)
      updates.description = params.description;
    if (params.model !== undefined) updates.model = params.model;
    if (params.userPrompt !== undefined) updates.userPrompt = params.userPrompt;
    if (params.responseType !== undefined)
      updates.responseType = params.responseType;
    if (params.enabled !== undefined) updates.enabled = params.enabled;
    if (params.schedule !== undefined) updates.schedule = params.schedule;
    if (params.toolkits !== undefined) updates.toolkits = params.toolkits;

    const [agent]: Agent[] = await api.db.db
      .update(agents)
      .set(updates)
      .where(and(eq(agents.id, params.id), eq(agents.userId, userId)))
      .returning();

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const systemPrompt = getSystemPrompt(agent);
    const [updatedAgent]: Agent[] = await api.db.db
      .update(agents)
      .set({ systemPrompt })
      .where(eq(agents.id, agent.id))
      .returning();

    return { agent: serializeAgent(updatedAgent) };
  }
}

export class AgentDelete implements Action {
  name = "agent:delete";
  description = "Delete an agent";
  web = { route: "/agent/:id", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
  });

  async run(params: ActionParams<AgentDelete>, connection: Connection) {
    const result = await api.db.db
      .delete(agents)
      .where(
        and(
          eq(agents.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      );

    return { success: result.rowCount > 0 };
  }
}

export class AgentView implements Action {
  name = "agent:view";
  description = "View an agent";
  web = { route: "/agent/:id", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
  });

  async run(params: ActionParams<AgentView>, connection: Connection) {
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { agent: serializeAgent(agent) };
  }
}

export class AgentList implements Action {
  name = "agent:list";
  description = "List your agents";
  web = { route: "/agents", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<AgentList>, connection: Connection) {
    const { limit, offset } = params;
    const userId = connection.session?.data.userId;
    const rows: Agent[] = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.userId, userId))
      .limit(limit)
      .offset(offset);

    const [total] = await api.db.db
      .select({ count: count() })
      .from(agents)
      .where(eq(agents.userId, userId));

    return { agents: rows.map(serializeAgent), total: total.count };
  }
}

export class AgentRunAction implements Action {
  name = "agent:run";
  description = "Enqueue an agent run";
  web = { route: "/agent/:id/run", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
  });

  async run(params: ActionParams<AgentRunAction>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Get the agent and verify ownership
    const [agent]: Agent[] = await api.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, params.id), eq(agents.userId, userId)))
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    if (!agent.enabled) {
      throw new TypedError({
        message: "Agent is not enabled",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    // Check toolkit authorization before enqueueing the job
    if (agent.toolkits && agent.toolkits.length > 0) {
      const unauthorizedToolkits = await getUnauthorizedToolkits(
        userId,
        agent.toolkits,
      );

      if (unauthorizedToolkits.length > 0) {
        throw new TypedError({
          message: `Agent cannot run because you are not authorized to use the following toolkits: ${unauthorizedToolkits.join(", ")}. Please authorize these toolkits or remove them from the agent.`,
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        });
      }
    }

    const [agentRun]: AgentRun[] = await api.db.db
      .insert(agent_run)
      .values({
        agentId: agent.id,
        systemPrompt: agent.systemPrompt,
        userMessage: agent.userPrompt,
        response: null,
        type: agent.responseType,
        status: "pending",
      })
      .returning();

    await api.actions.enqueue("agentRun:run", { id: agentRun.id });

    return {
      agent: serializeAgent(agent),
      run: serializeAgentRun(agentRun),
    };
  }
}
