import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getDbPath } from "../constants.ts";
import { withDb } from "../db/connection.ts";
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
import { generateThreadTitle } from "../utils/title.ts";
import { type ChatTurnCallbacks, runChatTurn } from "./agent.ts";

export interface ChatSession {
  dbPath: string;
  threadId: string;
  projectDir: string;
  config: Required<BotholomewConfig>;
  messages: MessageParam[];
  skills: Map<string, SkillDefinition>;
  // biome-ignore lint/suspicious/noExplicitAny: mcpx client
  mcpxClient: any;
  cleanup: () => Promise<void>;
}

export async function startChatSession(
  projectDir: string,
  existingThreadId?: string,
): Promise<ChatSession> {
  const config = await loadConfig(projectDir);

  if (!config.anthropic_api_key) {
    throw new Error(
      "no API key found. add anthropic_api_key to config/config.json",
    );
  }

  const dbPath = getDbPath(projectDir);
  await withDb(dbPath, (conn) => migrate(conn));

  let threadId: string;
  const messages: MessageParam[] = [];

  if (existingThreadId) {
    // Resume existing thread
    const result = await withDb(dbPath, (conn) =>
      getThread(conn, existingThreadId),
    );
    if (!result) {
      throw new Error(`Thread not found: ${existingThreadId}`);
    }
    threadId = existingThreadId;
    await withDb(dbPath, (conn) => reopenThread(conn, threadId));

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
      void generateThreadTitle(config, dbPath, threadId, firstUserMessage);
    }
  } else {
    threadId = await withDb(dbPath, (conn) =>
      createThread(conn, "chat_session", undefined, "New chat"),
    );
  }

  const mcpxClient = await createMcpxClient(projectDir);
  const skills = await loadSkills(projectDir);

  const cleanup = async () => {
    await mcpxClient?.close();
  };

  return {
    dbPath,
    threadId,
    projectDir,
    config,
    messages,
    skills,
    mcpxClient,
    cleanup,
  };
}

export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  callbacks: ChatTurnCallbacks,
): Promise<void> {
  // Hot-reload skills so any skill the agent created/edited last turn (or any
  // out-of-band edit) is visible to slash-command dispatch this turn.
  session.skills = await loadSkills(session.projectDir);

  // Log and append user message
  await withDb(session.dbPath, (conn) =>
    logInteraction(conn, session.threadId, {
      role: "user",
      kind: "message",
      content: userMessage,
    }),
  );

  session.messages.push({ role: "user", content: userMessage });

  // Auto-generate title after first user message in a new thread
  if (session.messages.length === 1) {
    void generateThreadTitle(
      session.config,
      session.dbPath,
      session.threadId,
      userMessage,
    );
  }

  await runChatTurn({
    messages: session.messages,
    projectDir: session.projectDir,
    config: session.config,
    dbPath: session.dbPath,
    threadId: session.threadId,
    mcpxClient: session.mcpxClient,
    callbacks,
  });
}

export async function endChatSession(session: ChatSession): Promise<void> {
  await withDb(session.dbPath, (conn) => endThread(conn, session.threadId));
  await session.cleanup();
}

/**
 * End the current thread and start a fresh one on the same session.
 * The old thread is persisted (marked ended) and can still be resumed
 * via `botholomew chat --thread-id <id>`. Returns the previous thread
 * ID so callers can display it to the user.
 */
export async function clearChatSession(
  session: ChatSession,
): Promise<{ previousThreadId: string; newThreadId: string }> {
  const previousThreadId = session.threadId;
  const newThreadId = await withDb(session.dbPath, async (conn) => {
    await endThread(conn, previousThreadId);
    return createThread(conn, "chat_session", undefined, "New chat");
  });
  session.threadId = newThreadId;
  session.messages.length = 0;
  return { previousThreadId, newThreadId };
}
