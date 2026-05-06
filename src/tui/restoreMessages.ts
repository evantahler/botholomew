import type { Interaction } from "../threads/store.ts";
import { MAX_INLINE_CHARS, PAGE_SIZE_CHARS } from "../worker/large-results.ts";
import type { ChatMessage } from "./components/MessageList.tsx";
import type { ToolCallData } from "./components/ToolCall.tsx";

let nextRestoreId = 0;
function restoreMsgId(): string {
  return `restore-msg-${++nextRestoreId}`;
}

function detectToolError(output: string | undefined): boolean {
  if (!output) return false;
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === "object" && parsed?.is_error === true) return true;
  } catch {
    /* not JSON */
  }
  return false;
}

/**
 * Reconstruct `ChatMessage[]` from a thread's interaction log so the TUI can
 * hydrate chat history (plus the Tools tab) when resuming a session.
 *
 * Tools attach to the assistant message that *issued* them, not the next one.
 * `runChatTurn` logs in the order: assistant text → tool_use(s) → tool_result(s)
 * → next assistant text, so we track the most recent assistant message and
 * append tool calls there until a user message resets the cursor.
 */
export function restoreMessagesFromInteractions(
  interactions: Interaction[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let currentAssistant: ChatMessage | null = null;
  let orphanTools: ToolCallData[] = [];
  let restoredIdx = 0;

  const makeToolCall = (ix: Interaction): ToolCallData => ({
    id: `restored-${restoredIdx++}`,
    name: ix.tool_name ?? "unknown",
    input: ix.tool_input ?? "{}",
    running: false,
    timestamp: ix.created_at,
  });

  for (const ix of interactions) {
    if (ix.kind === "tool_use") {
      const tc = makeToolCall(ix);
      if (currentAssistant) {
        const list = currentAssistant.toolCalls ?? [];
        list.push(tc);
        currentAssistant.toolCalls = list;
      } else {
        orphanTools.push(tc);
      }
    } else if (ix.kind === "tool_result") {
      const pool = currentAssistant?.toolCalls ?? orphanTools;
      const tc = pool.find((t) => t.name === ix.tool_name && !t.output);
      if (tc) {
        tc.output = ix.content;
        tc.isError = detectToolError(ix.content);
        if (ix.content.length > MAX_INLINE_CHARS) {
          tc.largeResult = {
            id: "(restored)",
            chars: ix.content.length,
            pages: Math.ceil(ix.content.length / PAGE_SIZE_CHARS),
          };
        }
      }
    } else if (ix.kind === "message" && ix.role === "user") {
      result.push({
        id: restoreMsgId(),
        role: "user",
        content: ix.content,
        timestamp: ix.created_at,
      });
      currentAssistant = null;
    } else if (ix.kind === "message" && ix.role === "assistant") {
      const msg: ChatMessage = {
        id: restoreMsgId(),
        role: "assistant",
        content: ix.content,
        timestamp: ix.created_at,
      };
      if (orphanTools.length > 0) {
        msg.toolCalls = [...orphanTools];
        orphanTools = [];
      }
      result.push(msg);
      currentAssistant = msg;
    }
  }

  if (orphanTools.length > 0) {
    result.push({
      id: restoreMsgId(),
      role: "assistant",
      content: "",
      timestamp: orphanTools[0]?.timestamp ?? new Date(),
      toolCalls: [...orphanTools],
    });
  }

  return result;
}
