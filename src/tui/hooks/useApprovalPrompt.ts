import { type MutableRefObject, useEffect, useState } from "react";
import type { ChatApprovalRequest } from "../../chat/approval.ts";
import type { ChatSession } from "../../chat/session.ts";
import { addAllowedTool } from "../../config/loader.ts";

export type ApprovalDecision = "approve" | "deny" | "always";

interface UseApprovalPromptResult {
  /** The pending approval request to render, or null. */
  pending: ChatApprovalRequest | null;
  /** Resolve the pending request. `always` also allowlists the tool. */
  decide: (decision: ApprovalDecision) => void;
}

/**
 * Subscribe to the chat session's approval bridge and expose the pending
 * request plus a `decide` callback for the inline TUI prompt. `always` appends
 * `<server>/<tool>` to `approvals.allowed_tools` (in-memory so the live session
 * stops prompting, and on disk so it persists) and approves.
 */
export function useApprovalPrompt(
  sessionRef: MutableRefObject<ChatSession | null>,
): UseApprovalPromptResult {
  const [, setTick] = useState(0);
  const bridge = sessionRef.current?.approvalBridge ?? null;

  useEffect(() => {
    if (!bridge) return;
    return bridge.subscribe(() => setTick((t) => t + 1));
  }, [bridge]);

  const pending = bridge?.current() ?? null;

  const decide = (decision: ApprovalDecision) => {
    const session = sessionRef.current;
    if (!session || !pending) return;
    if (decision === "always") {
      const pattern = `${pending.server}/${pending.tool}`;
      const allowed = session.config.approvals.allowed_tools;
      if (!allowed.includes(pattern)) allowed.push(pattern);
      void addAllowedTool(session.projectDir, pattern);
      session.approvalBridge.resolve(true);
      return;
    }
    session.approvalBridge.resolve(decision === "approve");
  };

  return { pending, decide };
}
