import { Box, Text, useInput } from "ink";
import { memo, useCallback, useEffect, useState } from "react";
import { decideAndRequeue } from "../../approvals/decide.ts";
import type { Approval, ApprovalStatus } from "../../approvals/schema.ts";
import { listApprovals } from "../../approvals/store.ts";
import { theme } from "../theme.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { useTerminalSize } from "../useTerminalSize.ts";

interface ApprovalPanelProps {
  projectDir: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 44;

const STATUS_ICONS: Record<ApprovalStatus, string> = {
  pending: "◌",
  approved: "✔",
  denied: "✖",
};

const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending: theme.accent,
  approved: theme.success,
  denied: theme.error,
};

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

export const ApprovalPanel = memo(function ApprovalPanel({
  projectDir,
  isActive,
}: ApprovalPanelProps) {
  const { rows: termRows } = useTerminalSize();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await listApprovals(projectDir);
        if (mounted) {
          setApprovals(result);
          setSelectedIndex((prev) =>
            Math.min(prev, Math.max(0, result.length - 1)),
          );
        }
      } catch {
        // ignore — next tick retries
      }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, refreshTick]);

  const forceRefresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const selected = approvals[selectedIndex];
  const approvalsRef = useLatestRef(approvals);
  const selectedRef = useLatestRef(selected);

  const decide = useCallback(
    (decision: "approved" | "denied") => {
      const a = selectedRef.current;
      if (!a || a.status !== "pending") return;
      void decideAndRequeue(projectDir, a.id, decision, "tui").then(() => {
        setNotice(
          `${decision === "approved" ? "Approved" : "Denied"} ${a.server}/${a.tool}`,
        );
        forceRefresh();
      });
    },
    [projectDir, forceRefresh, selectedRef],
  );

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setSelectedIndex((i) =>
          Math.min(approvalsRef.current.length - 1, i + 1),
        );
        return;
      }
      if (input === "a") decide("approved");
      else if (input === "d") decide("denied");
      else if (key.ctrl && (input === "r" || input === "R")) forceRefresh();
    },
    { isActive },
  );

  const visibleRows = Math.max(1, termRows - 6);
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  if (approvals.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          No approval requests. When a worker hits a gated mcpx tool, the
          request appears here for you to approve or deny.
        </Text>
      </Box>
    );
  }

  const sidebarOffset = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleRows / 2),
      approvals.length - visibleRows,
    ),
  );
  const sidebarVisible = approvals.slice(
    sidebarOffset,
    sidebarOffset + visibleRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      <Box
        flexDirection="column"
        width={SIDEBAR_WIDTH}
        height={visibleRows + 1}
        borderStyle="single"
        borderColor={theme.muted}
        borderRight
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        overflow="hidden"
      >
        <Box paddingX={1}>
          <Text bold dimColor>
            Approvals ({approvals.length}
            {pendingCount > 0 ? `, ${pendingCount} pending` : ""})
          </Text>
        </Box>
        {sidebarVisible.map((a, vi) => {
          const i = vi + sidebarOffset;
          const isSelected = i === selectedIndex;
          const label = `${a.server}/${a.tool}`;
          const maxName = SIDEBAR_WIDTH - 8;
          const nameDisplay =
            label.length > maxName ? `${label.slice(0, maxName - 1)}…` : label;
          return (
            <Box key={a.id} paddingX={1}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                bold={isSelected}
                color={isSelected ? theme.info : undefined}
                wrap="truncate-end"
              >
                {isSelected ? "▸" : " "}{" "}
                <Text color={STATUS_COLORS[a.status]}>
                  {STATUS_ICONS[a.status]}
                </Text>{" "}
                {nameDisplay}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        overflow="hidden"
      >
        {selected && (
          <>
            <Text bold color={theme.toolName} wrap="truncate-end">
              {selected.server}/{selected.tool}
            </Text>
            <Text>
              <Text color={STATUS_COLORS[selected.status]}>
                {STATUS_ICONS[selected.status]} {selected.status}
              </Text>
              {selected.reason ? (
                <Text dimColor> · {selected.reason}</Text>
              ) : null}
            </Text>
            {selected.task_id && <Text dimColor>task: {selected.task_id}</Text>}
            <Box marginTop={1} flexDirection="column">
              <Text bold color={theme.primary}>
                Arguments
              </Text>
              <Text dimColor wrap="truncate-end">
                {prettyArgs(selected.args)}
              </Text>
            </Box>
          </>
        )}
        <Box flexGrow={1} />
        {notice && <Text color={theme.success}>{notice}</Text>}
        <Text dimColor>
          ↑↓ select · <Text color={theme.success}>a</Text> approve ·{" "}
          <Text color={theme.error}>d</Text> deny · ^R refresh
        </Text>
      </Box>
    </Box>
  );
});
