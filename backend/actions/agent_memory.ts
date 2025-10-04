import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { agents } from "../models/agent";
import {
  agent_memories,
  AgentMemory,
  memoryTypes,
} from "../models/agent_memory";
import { serializeAgentMemory } from "../ops/AgentMemoryOps";

export class AgentMemoryCreate implements Action {
  name = "agent:memory:create";
  description = "Create a new memory for an agent";
  web = { route: "/agent/:id/memory", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    key: z
      .string()
      .min(1, "Key is required and must be at least 1 character long")
      .max(256, "Key must be less than 256 characters")
      .describe("The memory's key/identifier"),
    content: z
      .string()
      .min(1, "Content is required")
      .describe("The memory content"),
    memoryType: z
      .enum(memoryTypes.enumValues)
      .default("fact")
      .describe("The type of memory"),
    metadata: z
      .record(z.any())
      .optional()
      .describe("Additional metadata for the memory"),
    expiresAt: z.coerce
      .date()
      .optional()
      .describe("Optional expiration date for the memory"),
  });

  async run(params: ActionParams<AgentMemoryCreate>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify agent ownership
    const [agent] = await api.db.db
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

    const [memory]: AgentMemory[] = await api.db.db
      .insert(agent_memories)
      .values({
        agentId: params.id,
        key: params.key,
        content: params.content,
        memoryType: params.memoryType,
        metadata: params.metadata || {},
        expiresAt: params.expiresAt || null,
      })
      .returning();

    return { memory: serializeAgentMemory(memory) };
  }
}

export class AgentMemoryList implements Action {
  name = "agent:memory:list";
  description = "List memories for an agent";
  web = { route: "/agent/:id/memories", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    memoryType: z.enum(memoryTypes.enumValues).optional(),
  });

  async run(params: ActionParams<AgentMemoryList>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify agent ownership
    const [agent] = await api.db.db
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

    const { limit, offset } = params;

    // Build query with optional type filter
    let whereConditions = eq(agent_memories.agentId, params.id);
    if (params.memoryType) {
      whereConditions = and(
        whereConditions,
        eq(agent_memories.memoryType, params.memoryType),
      )!;
    }

    const rows: AgentMemory[] = await api.db.db
      .select()
      .from(agent_memories)
      .where(whereConditions)
      .orderBy(desc(agent_memories.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await api.db.db
      .select({ count: count() })
      .from(agent_memories)
      .where(whereConditions);

    return {
      memories: rows.map(serializeAgentMemory),
      total: total.count,
    };
  }
}

export class AgentMemoryView implements Action {
  name = "agent:memory:view";
  description = "View a specific memory";
  web = { route: "/agent/:id/memory/:memoryId", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    memoryId: z.coerce.number().int().describe("The memory's id"),
  });

  async run(params: ActionParams<AgentMemoryView>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify agent ownership
    const [agent] = await api.db.db
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

    const [memory] = await api.db.db
      .select()
      .from(agent_memories)
      .where(
        and(
          eq(agent_memories.id, params.memoryId),
          eq(agent_memories.agentId, params.id),
        ),
      )
      .limit(1);

    if (!memory) {
      throw new TypedError({
        message: "Memory not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { memory: serializeAgentMemory(memory) };
  }
}

export class AgentMemoryEdit implements Action {
  name = "agent:memory:edit";
  description = "Edit an existing memory";
  web = { route: "/agent/:id/memory/:memoryId", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    memoryId: z.coerce.number().int().describe("The memory's id"),
    key: z.string().min(1).max(256).optional(),
    content: z.string().optional(),
    memoryType: z.enum(memoryTypes.enumValues).optional(),
    metadata: z.record(z.any()).optional(),
    expiresAt: z.coerce.date().optional().nullable(),
  });

  async run(params: ActionParams<AgentMemoryEdit>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify agent ownership
    const [agent] = await api.db.db
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

    const updates: Record<string, any> = {};
    if (params.key !== undefined) updates.key = params.key;
    if (params.content !== undefined) updates.content = params.content;
    if (params.memoryType !== undefined) updates.memoryType = params.memoryType;
    if (params.metadata !== undefined) updates.metadata = params.metadata;
    if (params.expiresAt !== undefined) updates.expiresAt = params.expiresAt;

    const [memory]: AgentMemory[] = await api.db.db
      .update(agent_memories)
      .set(updates)
      .where(
        and(
          eq(agent_memories.id, params.memoryId),
          eq(agent_memories.agentId, params.id),
        ),
      )
      .returning();

    if (!memory) {
      throw new TypedError({
        message: "Memory not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { memory: serializeAgentMemory(memory) };
  }
}

export class AgentMemoryDelete implements Action {
  name = "agent:memory:delete";
  description = "Delete a memory";
  web = { route: "/agent/:id/memory/:memoryId", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The agent's id"),
    memoryId: z.coerce.number().int().describe("The memory's id"),
  });

  async run(params: ActionParams<AgentMemoryDelete>, connection: Connection) {
    const userId = connection.session?.data.userId;
    if (!userId) {
      throw new TypedError({
        message: "User session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    // Verify agent ownership
    const [agent] = await api.db.db
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

    const result = await api.db.db
      .delete(agent_memories)
      .where(
        and(
          eq(agent_memories.id, params.memoryId),
          eq(agent_memories.agentId, params.id),
        ),
      );

    return { success: (result.rowCount ?? 0) > 0 };
  }
}
