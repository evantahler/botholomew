import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { loadConfig } from "../config/loader.ts";
import type { ResolvedConfig } from "../config/schemas.ts";
import { getDbPath } from "../constants.ts";
import type { DbConnection } from "../db/connection.ts";
import { getConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import {
  createThread,
  endThread,
  getThread,
  logInteraction,
  reopenThread,
} from "../db/threads.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import type { ToolContext } from "../tools/tool.ts";
import {
  buildChatSystemPrompt,
  type ChatTurnCallbacks,
  runChatTurn,
} from "./agent.ts";

export interface ChatSession {
  conn: DbConnection;
  threadId: string;
  projectDir: string;
  config: ResolvedConfig;
  messages: MessageParam[];
  systemPrompt: string;
  toolCtx: ToolContext;
  cleanup: () => Promise<void>;
}

export async function startChatSession(
  projectDir: string,
  existingThreadId?: string,
): Promise<ChatSession> {
  const config = await loadConfig(projectDir);

  if (!config.anthropic_api_key) {
    throw new Error(
      "no API key found. add anthropic_api_key to .botholomew/config.json",
    );
  }

  const conn = getConnection(getDbPath(projectDir));
  migrate(conn);

  let threadId: string;
  const messages: MessageParam[] = [];

  if (existingThreadId) {
    // Resume existing thread
    const result = await getThread(conn, existingThreadId);
    if (!result) {
      conn.close();
      throw new Error(`Thread not found: ${existingThreadId}`);
    }
    threadId = existingThreadId;
    await reopenThread(conn, threadId);

    // Rebuild message history from interactions
    for (const interaction of result.interactions) {
      if (interaction.kind !== "message") continue;
      if (interaction.role === "user") {
        messages.push({ role: "user", content: interaction.content });
      } else if (interaction.role === "assistant") {
        messages.push({ role: "assistant", content: interaction.content });
      }
    }
  } else {
    threadId = await createThread(
      conn,
      "chat_session",
      undefined,
      "Interactive chat",
    );
  }

  const systemPrompt = await buildChatSystemPrompt(projectDir);

  const mcpxClient = await createMcpxClient(projectDir);

  const toolCtx: ToolContext = {
    conn,
    projectDir,
    config,
    mcpxClient,
  };

  const cleanup = async () => {
    await mcpxClient?.close();
  };

  return {
    conn,
    threadId,
    projectDir,
    config,
    messages,
    systemPrompt,
    toolCtx,
    cleanup,
  };
}

export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  callbacks: ChatTurnCallbacks,
): Promise<void> {
  // Log and append user message
  await logInteraction(session.conn, session.threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  session.messages.push({ role: "user", content: userMessage });

  await runChatTurn({
    messages: session.messages,
    systemPrompt: session.systemPrompt,
    config: session.config,
    conn: session.conn,
    threadId: session.threadId,
    toolCtx: session.toolCtx,
    callbacks,
  });
}

export async function endChatSession(session: ChatSession): Promise<void> {
  await endThread(session.conn, session.threadId);
  await session.cleanup();
  session.conn.close();
}
