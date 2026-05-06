import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import { getDbPath } from "../constants.ts";
import { withDb } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { createMcpxClient } from "../mcpx/client.ts";
import { loadSkills } from "../skills/loader.ts";
import type { SkillDefinition } from "../skills/parser.ts";
import {
  createThread,
  endThread,
  ensureThreadsDir,
  getThread,
  logInteraction,
  reopenThread,
} from "../threads/store.ts";
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
  /** Set by `runChatTurn` while a `messages.stream(...)` is in flight. */
  activeStream: MessageStream | null;
  /** Esc-driven steer signal — checked at safe points in the chat agent loop. */
  aborted: boolean;
}

/**
 * Abort the in-flight LLM stream (if any) and set the steer flag so the chat
 * agent loop short-circuits before issuing another `messages.stream(...)` call.
 * Safe to call when no stream is active. Returns true if a live stream was aborted.
 */
export function abortActiveStream(session: ChatSession): boolean {
  session.aborted = true;
  if (session.activeStream && !session.activeStream.aborted) {
    session.activeStream.abort();
    return true;
  }
  return false;
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
  await ensureThreadsDir(projectDir);

  let threadId: string;
  const messages: MessageParam[] = [];

  if (existingThreadId) {
    // Resume existing thread
    const result = await getThread(projectDir, existingThreadId);
    if (!result) {
      throw new Error(`Thread not found: ${existingThreadId}`);
    }
    threadId = existingThreadId;
    await reopenThread(projectDir, threadId);

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
      void generateThreadTitle(config, projectDir, threadId, firstUserMessage);
    }
  } else {
    threadId = await createThread(
      projectDir,
      "chat_session",
      undefined,
      "New chat",
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
    activeStream: null,
    aborted: false,
  };
}

export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  callbacks: ChatTurnCallbacks,
): Promise<void> {
  // Reset steer flag so a previous turn's Esc doesn't poison this one.
  session.aborted = false;

  // Hot-reload skills so any skill the agent created/edited last turn (or any
  // out-of-band edit) is visible to slash-command dispatch this turn.
  session.skills = await loadSkills(session.projectDir);

  // Log and append user message
  await logInteraction(session.projectDir, session.threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  session.messages.push({ role: "user", content: userMessage });

  // Auto-generate title after first user message in a new thread
  if (session.messages.length === 1) {
    void generateThreadTitle(
      session.config,
      session.projectDir,
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
    session,
  });
}

export async function endChatSession(session: ChatSession): Promise<void> {
  await endThread(session.projectDir, session.threadId);
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
  // Abort any in-flight stream up front so its callbacks don't continue to
  // fire into the new thread (caused #190 — old messages reappearing on the
  // next user submission).
  abortActiveStream(session);
  const previousThreadId = session.threadId;
  await endThread(session.projectDir, previousThreadId);
  const newThreadId = await createThread(
    session.projectDir,
    "chat_session",
    undefined,
    "New chat",
  );
  session.threadId = newThreadId;
  session.messages.length = 0;
  session.activeStream = null;
  session.aborted = false;
  return { previousThreadId, newThreadId };
}
