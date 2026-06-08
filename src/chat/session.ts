import type { ModelMessage } from "ai";
import { loadConfig } from "../config/loader.ts";
import type { BotholomewConfig } from "../config/schemas.ts";
import type { AbortHandle } from "../llm/abort.ts";
import { BotholomewLlmError } from "../llm/types.ts";
import {
  buildApprovalPolicy,
  createMcpxClient,
  resolveMcpxDir,
} from "../mcpx/client.ts";
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
import { type ChatApprovalBridge, createApprovalBridge } from "./approval.ts";

export interface ChatSession {
  threadId: string;
  projectDir: string;
  config: BotholomewConfig;
  messages: ModelMessage[];
  skills: Map<string, SkillDefinition>;
  // biome-ignore lint/suspicious/noExplicitAny: mcpx client
  mcpxClient: any;
  /** Drives the inline tool-approval prompt in the TUI. */
  approvalBridge: ChatApprovalBridge;
  cleanup: () => Promise<void>;
  /** Set by `runChatTurn` while a `streamText(...)` is in flight. */
  activeAbort: AbortHandle | null;
  /** Esc-driven steer signal — checked at safe points in the chat agent loop. */
  aborted: boolean;
}

/**
 * Abort the in-flight LLM stream (if any) and set the steer flag so the chat
 * agent loop short-circuits before issuing another `streamText(...)` call.
 * Safe to call when no stream is active. Returns true if a live stream was aborted.
 */
export function abortActiveStream(session: ChatSession): boolean {
  session.aborted = true;
  if (session.activeAbort && !session.activeAbort.signal.aborted) {
    session.activeAbort.controller.abort();
    return true;
  }
  return false;
}

function requireProviderCreds(config: BotholomewConfig): void {
  const { llm } = config;
  if (llm.provider === "anthropic" && !llm.api_key) {
    throw new BotholomewLlmError(
      "no_credentials",
      "Anthropic provider requires `llm.api_key` (or set ANTHROPIC_API_KEY). Update config/config.json.",
    );
  }
  if (llm.provider === "openai-compatible" && !llm.base_url) {
    throw new BotholomewLlmError(
      "no_credentials",
      "OpenAI-compatible provider requires `llm.base_url`. Update config/config.json.",
    );
  }
}

export async function startChatSession(
  projectDir: string,
  existingThreadId?: string,
  opts: { unsafe?: boolean } = {},
): Promise<ChatSession> {
  const config = await loadConfig(projectDir);

  requireProviderCreds(config);

  await ensureThreadsDir(projectDir);

  let threadId: string;
  const messages: ModelMessage[] = [];

  if (existingThreadId) {
    const result = await getThread(projectDir, existingThreadId);
    if (!result) {
      throw new Error(`Thread not found: ${existingThreadId}`);
    }
    threadId = existingThreadId;
    await reopenThread(projectDir, threadId);

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

  // The approval gate. The bridge must exist before the mcpx client so the
  // client's callback can reference it. When the gate is off (`--unsafe` or
  // `approvals.enabled: false`) the policy is undefined and the callback is
  // never invoked.
  const approvalBridge = createApprovalBridge();
  const approvalPolicy = buildApprovalPolicy(config, { unsafe: opts.unsafe });
  const mcpxClient = await createMcpxClient(
    resolveMcpxDir(projectDir, config),
    {
      approvalPolicy,
      onApprovalRequired: approvalPolicy
        ? (req) =>
            approvalBridge.request({
              server: req.server,
              tool: req.tool,
              args: req.args,
              reason: req.reason,
            })
        : undefined,
    },
  );
  const skills = await loadSkills(projectDir);

  const cleanup = async () => {
    await mcpxClient?.close();
  };

  return {
    threadId,
    projectDir,
    config,
    messages,
    skills,
    mcpxClient,
    approvalBridge,
    cleanup,
    activeAbort: null,
    aborted: false,
  };
}

export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  callbacks: ChatTurnCallbacks,
): Promise<void> {
  session.aborted = false;

  session.skills = await loadSkills(session.projectDir);

  await logInteraction(session.projectDir, session.threadId, {
    role: "user",
    kind: "message",
    content: userMessage,
  });

  session.messages.push({ role: "user", content: userMessage });

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
 */
export async function clearChatSession(
  session: ChatSession,
): Promise<{ previousThreadId: string; newThreadId: string }> {
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
  session.activeAbort = null;
  session.aborted = false;
  return { previousThreadId, newThreadId };
}
