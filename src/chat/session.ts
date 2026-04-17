import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
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
import { loadSkills } from "../skills/loader.ts";
import type { SkillDefinition } from "../skills/parser.ts";
import type { ToolContext } from "../tools/tool.ts";
import { generateThreadTitle } from "../utils/title.ts";
import { type ChatTurnCallbacks, runChatTurn } from "./agent.ts";

export interface ChatSession {
  conn: DbConnection;
  threadId: string;
  projectDir: string;
  config: Required<BotholomewConfig>;
  messages: MessageParam[];
  toolCtx: ToolContext;
  skills: Map<string, SkillDefinition>;
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

  const conn = await getConnection(getDbPath(projectDir));
  await migrate(conn);

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
    let firstUserMessage: string | undefined;
    for (const interaction of result.interactions) {
      if (interaction.kind !== "message") continue;
      if (interaction.role === "user") {
        if (!firstUserMessage) firstUserMessage = interaction.content;
        messages.push({ role: "user", content: interaction.content });
      } else if (interaction.role === "assistant") {
        messages.push({ role: "assistant", content: interaction.content });
      }
    }

    // Backfill title for threads that still have the default
    if (result.thread.title === "New chat" && firstUserMessage) {
      void generateThreadTitle(config, conn, threadId, firstUserMessage);
    }
  } else {
    threadId = await createThread(conn, "chat_session", undefined, "New chat");
  }

  const mcpxClient = await createMcpxClient(projectDir);
  const skills = await loadSkills(projectDir);

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
    toolCtx,
    skills,
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

  // Auto-generate title after first user message in a new thread
  if (session.messages.length === 1) {
    void generateThreadTitle(
      session.config,
      session.conn,
      session.threadId,
      userMessage,
    );
  }

  await runChatTurn({
    messages: session.messages,
    projectDir: session.projectDir,
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
