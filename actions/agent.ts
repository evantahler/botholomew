import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { serializeAgent } from "../ops/AgentOps";
import { agents } from "../models/agent";
import { SessionMiddleware } from "../middleware/session";
import { eq, and } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";

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
    systemPrompt: z
      .string()
      .min(1, "System prompt is required")
      .describe("The system prompt for the agent"),
    contextSummary: z
      .string()
      .optional()
      .describe("A summary of the agent's context"),
    enabled: z.coerce
      .boolean()
      .default(false)
      .describe("Whether the agent is enabled"),
    schedule: z
      .string()
      .optional()
      .describe("Cron schedule for the agent (if applicable)"),
  });

  async run(params: ActionParams<AgentCreate>, connection: Connection) {
    const [agent] = await api.db.db
      .insert(agents)
      .values({
        userId: connection.session?.data.userId,
        name: params.name,
        description: params.description,
        model: params.model,
        systemPrompt: params.systemPrompt,
        contextSummary: params.contextSummary,
        enabled: params.enabled,
        schedule: params.schedule,
      })
      .returning();

    return { agent: serializeAgent(agent) };
  }
}

export class AgentEdit implements Action {
  name = "agent:edit";
  description = "Edit an existing agent";
  web = { route: "/agent", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    name: z.string().min(1).max(256).optional(),
    description: z.string().optional(),
    model: z.string().min(1).max(256).optional(),
    systemPrompt: z.string().optional(),
    contextSummary: z.string().optional(),
    enabled: z.coerce.boolean().optional(),
    schedule: z.string().optional(),
  });

  async run(params: ActionParams<AgentEdit>, connection: Connection) {
    const updates: Record<string, any> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined)
      updates.description = params.description;
    if (params.model !== undefined) updates.model = params.model;
    if (params.systemPrompt !== undefined)
      updates.systemPrompt = params.systemPrompt;
    if (params.contextSummary !== undefined)
      updates.contextSummary = params.contextSummary;
    if (params.enabled !== undefined) updates.enabled = params.enabled;
    if (params.schedule !== undefined) updates.schedule = params.schedule;

    const [agent] = await api.db.db
      .update(agents)
      .set(updates)
      .where(
        and(
          eq(agents.id, params.id),
          eq(agents.userId, connection.session?.data.userId)
        )
      )
      .returning();

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    return { agent: serializeAgent(agent) };
  }
}

export class AgentDelete implements Action {
  name = "agent:delete";
  description = "Delete an agent";
  web = { route: "/agent", method: HTTP_METHOD.DELETE };
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
          eq(agents.userId, connection.session?.data.userId)
        )
      );

    return { success: result.rowCount > 0 };
  }
}

export class AgentView implements Action {
  name = "agent:view";
  description = "View an agent";
  web = { route: "/agent", method: HTTP_METHOD.GET };
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
          eq(agents.userId, connection.session?.data.userId)
        )
      )
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
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
    const rows = await api.db.db
      .select()
      .from(agents)
      .where(eq(agents.userId, userId))
      .limit(limit)
      .offset(offset);
    return { agents: rows.map(serializeAgent) };
  }
}
