import { Box, Text, useInput } from "ink";
import type { ChatApprovalRequest } from "../../chat/approval.ts";
import type { ApprovalDecision } from "../hooks/useApprovalPrompt.ts";
import { theme } from "../theme.ts";

interface ApprovalPromptProps {
  request: ChatApprovalRequest | null;
  onDecide: (decision: ApprovalDecision) => void;
}

/** Compact one-line preview of the tool arguments. */
function previewArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (json === undefined) return "{}";
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

/**
 * Inline modal asking the user to approve a gated mcpx tool call. While a
 * request is pending it owns keyboard input (y/a/n/Esc); App disables the
 * input bar and global keybindings so the keystrokes land here.
 */
export function ApprovalPrompt({ request, onDecide }: ApprovalPromptProps) {
  useInput(
    (input, key) => {
      if (key.escape || input === "n") onDecide("deny");
      else if (input === "y") onDecide("approve");
      else if (input === "a") onDecide("always");
    },
    { isActive: !!request },
  );

  if (!request) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accentBorder}
      paddingX={1}
    >
      <Text color={theme.accent} bold>
        ⚠ Approve tool call?
      </Text>
      <Text>
        <Text color={theme.toolName} bold>
          {request.server}/{request.tool}
        </Text>
        <Text color={theme.muted}> ({request.reason})</Text>
      </Text>
      <Text color={theme.muted}>{previewArgs(request.args)}</Text>
      <Text>
        <Text color={theme.success} bold>
          y
        </Text>{" "}
        approve ·{" "}
        <Text color={theme.info} bold>
          a
        </Text>{" "}
        always allow this tool ·{" "}
        <Text color={theme.error} bold>
          n
        </Text>
        /Esc deny
      </Text>
    </Box>
  );
}
