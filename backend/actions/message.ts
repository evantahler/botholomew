import { z } from "zod";
import { api, Action, type ActionParams, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { serializeMessage } from "../ops/MessageOps";
import { messages } from "../models/message";
import { agents } from "../models/agent";
import { SessionMiddleware } from "../middleware/session";
import { eq, and } from "drizzle-orm";
import { ErrorType, TypedError } from "../classes/TypedError";

export class MessageCreate implements Action {
  name = "message:create";
  description = "Create a new message for an agent";
  web = { route: "/message", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    agentId: z.coerce.number().int().describe("The agent's id"),
    role: z.enum(["user", "assistant", "system"]).describe("The message role"),
    content: z
      .string()
      .min(1, "Content is required and must be at least 1 character long")
      .describe("The message content"),
  });

  async run(params: ActionParams<MessageCreate>, connection: Connection) {
    // Verify the agent belongs to the user
    const [agent] = await api.db.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, params.agentId),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!agent) {
      throw new TypedError({
        message: "Agent not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    const [message] = await api.db.db
      .insert(messages)
      .values({
        agentId: params.agentId,
        role: params.role,
        content: params.content,
      })
      .returning();

    return { message: serializeMessage(message) };
  }
}

export class MessageEdit implements Action {
  name = "message:edit";
  description = "Edit an existing message";
  web = { route: "/message", method: HTTP_METHOD.POST };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The message's id"),
    role: z.enum(["user", "assistant", "system"]).optional(),
    content: z.string().min(1).optional(),
  });

  async run(params: ActionParams<MessageEdit>, connection: Connection) {
    const updates: Record<string, any> = {};
    if (params.role !== undefined) updates.role = params.role;
    if (params.content !== undefined) updates.content = params.content;

    // First verify the message belongs to an agent owned by the user
    const [existingMessage] = await api.db.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(
        and(
          eq(messages.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!existingMessage) {
      throw new TypedError({
        message: "Message not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    const [message] = await api.db.db
      .update(messages)
      .set(updates)
      .where(eq(messages.id, params.id))
      .returning();

    return { message: serializeMessage(message) };
  }
}

export class MessageDelete implements Action {
  name = "message:delete";
  description = "Delete a message";
  web = { route: "/message", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The message's id"),
  });

  async run(params: ActionParams<MessageDelete>, connection: Connection) {
    // First check if the message belongs to an agent owned by the user
    const [message] = await api.db.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(
        and(
          eq(messages.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!message) {
      return { success: false };
    }

    // Delete the message
    const result = await api.db.db
      .delete(messages)
      .where(eq(messages.id, params.id));

    return { success: result.rowCount > 0 };
  }
}

export class MessageView implements Action {
  name = "message:view";
  description = "View a message";
  web = { route: "/message/:id", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    id: z.coerce.number().int().describe("The message's id"),
  });

  async run(params: ActionParams<MessageView>, connection: Connection) {
    const [message] = await api.db.db
      .select({
        id: messages.id,
        agentId: messages.agentId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(
        and(
          eq(messages.id, params.id),
          eq(agents.userId, connection.session?.data.userId),
        ),
      )
      .limit(1);

    if (!message) {
      throw new TypedError({
        message: "Message not found or not owned by user",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    return { message: serializeMessage(message) };
  }
}

export class MessageList implements Action {
  name = "message:list";
  description = "List messages for an agent";
  web = { route: "/messages", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({
    agentId: z.coerce.number().int().describe("The agent's id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  async run(params: ActionParams<MessageList>, connection: Connection) {
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

    const rows = await api.db.db
      .select()
      .from(messages)
      .where(eq(messages.agentId, agentId))
      .orderBy(messages.createdAt)
      .limit(limit)
      .offset(offset);

    return { messages: rows.map(serializeMessage) };
  }
}
