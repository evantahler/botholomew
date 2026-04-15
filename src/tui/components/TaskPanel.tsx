import { Box, Text, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DbConnection } from "../../db/connection.ts";
import {
  listTasks,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "../../db/tasks.ts";
import { theme } from "../theme.ts";

interface TaskPanelProps {
  conn: DbConnection;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;
const PAGE_SCROLL_LINES = 10;

// ANSI escape helpers (same as ToolPanel)
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";

const STATUS_ICONS: Record<Task["status"], string> = {
  pending: "○",
  in_progress: "●",
  waiting: "◌",
  failed: "✖",
  complete: "✔",
};

const STATUS_COLORS: Record<Task["status"], string> = {
  pending: theme.muted,
  in_progress: theme.accent,
  waiting: theme.info,
  failed: theme.error,
  complete: theme.success,
};

const STATUS_ANSI: Record<Task["status"], string> = {
  pending: DIM,
  in_progress: YELLOW,
  waiting: CYAN,
  failed: RED,
  complete: GREEN,
};

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  high: "HI",
  medium: "MD",
  low: "LO",
};

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  high: theme.error,
  medium: theme.accent,
  low: theme.muted,
};

const PRIORITY_ANSI: Record<Task["priority"], string> = {
  high: RED,
  medium: YELLOW,
  low: DIM,
};

function buildTaskDetailAnsi(task: Task): string {
  const lines: string[] = [];

  lines.push(`${BOLD}${CYAN}${task.name}${RESET}`);
  lines.push("");

  const statusAnsi = STATUS_ANSI[task.status];
  lines.push(
    `${BOLD}${BLUE}Status${RESET}    ${statusAnsi}${STATUS_ICONS[task.status]} ${task.status}${RESET}`,
  );

  const priorityAnsi = PRIORITY_ANSI[task.priority];
  lines.push(
    `${BOLD}${BLUE}Priority${RESET}  ${priorityAnsi}${task.priority}${RESET}`,
  );

  lines.push(
    `${BOLD}${BLUE}Claimed${RESET}   ${task.claimed_by ? task.claimed_by : `${DIM}(unclaimed)${RESET}`}`,
  );

  const created = task.created_at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const updated = task.updated_at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  lines.push(`${BOLD}${BLUE}Created${RESET}   ${DIM}${created}${RESET}`);
  lines.push(`${BOLD}${BLUE}Updated${RESET}   ${DIM}${updated}${RESET}`);
  lines.push("");

  if (task.description) {
    lines.push(`${BOLD}${BLUE}Description${RESET}`);
    lines.push(task.description);
    lines.push("");
  }

  if (task.status === "waiting" && task.waiting_reason) {
    lines.push(`${BOLD}${BLUE}Waiting Reason${RESET}`);
    lines.push(`${YELLOW}${task.waiting_reason}${RESET}`);
    lines.push("");
  }

  if (task.blocked_by.length > 0) {
    lines.push(`${BOLD}${BLUE}Blocked By${RESET}`);
    for (const id of task.blocked_by) {
      lines.push(`  ${DIM}• ${id}${RESET}`);
    }
    lines.push("");
  }

  if (task.context_ids.length > 0) {
    lines.push(`${BOLD}${BLUE}Context IDs${RESET}`);
    for (const id of task.context_ids) {
      lines.push(`  ${DIM}• ${id}${RESET}`);
    }
  }

  return lines.join("\n");
}

// Cycle through filter options: null -> ...values -> null
function cycleFilter<T>(current: T | null, values: readonly T[]): T | null {
  if (current === null) return values[0] ?? null;
  const idx = values.indexOf(current);
  if (idx === -1 || idx === values.length - 1) return null;
  return values[idx + 1] ?? null;
}

export function TaskPanel({ conn, isActive }: TaskPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [statusFilter, setStatusFilter] = useState<Task["status"] | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Task["priority"] | null>(
    null,
  );
  const [refreshTick, setRefreshTick] = useState(0);

  // Fetch tasks on mount, filter change, and every 5 seconds
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const filters: {
        status?: Task["status"];
        priority?: Task["priority"];
      } = {};
      if (statusFilter) filters.status = statusFilter;
      if (priorityFilter) filters.priority = priorityFilter;
      const result = await listTasks(conn, filters);
      if (mounted) {
        setTasks(result);
        setSelectedIndex((prev) =>
          Math.min(prev, Math.max(0, result.length - 1)),
        );
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [conn, statusFilter, priorityFilter, refreshTick]);

  const selectedTask = tasks[selectedIndex];

  const renderedDetail = useMemo(() => {
    if (!selectedTask) return "";
    return buildTaskDetailAnsi(selectedTask);
  }, [selectedTask]);

  const detailLines = useMemo(
    () => renderedDetail.split("\n"),
    [renderedDetail],
  );

  const visibleRows = Math.max(1, termRows - 6);
  const maxDetailScroll = Math.max(0, detailLines.length - visibleRows);
  const sidebarScrollOffset = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleRows / 2),
      tasks.length - visibleRows,
    ),
  );

  // Reset detail scroll when selection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is the intentional trigger
  useEffect(() => {
    setDetailScroll(0);
  }, [selectedIndex]);

  const forceRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        if (key.shift) {
          setDetailScroll((s) => Math.max(0, s - 1));
        } else {
          setSelectedIndex((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (key.shift) {
          setDetailScroll((s) => Math.min(maxDetailScroll, s + 1));
        } else {
          setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
        }
        return;
      }

      if (input === "j") {
        setDetailScroll((s) => Math.min(maxDetailScroll, s + 1));
        return;
      }
      if (input === "k") {
        setDetailScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (input === "J") {
        setDetailScroll((s) =>
          Math.min(maxDetailScroll, s + PAGE_SCROLL_LINES),
        );
        return;
      }
      if (input === "K") {
        setDetailScroll((s) => Math.max(0, s - PAGE_SCROLL_LINES));
        return;
      }
      if (input === "g") {
        setDetailScroll(0);
        return;
      }
      if (input === "G") {
        setDetailScroll(maxDetailScroll);
        return;
      }

      if (input === "f") {
        setStatusFilter((f) => cycleFilter(f, TASK_STATUSES));
        return;
      }
      if (input === "p") {
        setPriorityFilter((f) => cycleFilter(f, TASK_PRIORITIES));
        return;
      }
      if (input === "r") {
        forceRefresh();
        return;
      }
    },
    { isActive },
  );

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          {statusFilter || priorityFilter
            ? "No tasks match the current filters. Press f/p to change filters."
            : "No tasks found. Tasks will appear here as they are created."}
        </Text>
        {(statusFilter || priorityFilter) && (
          <Box marginTop={1}>
            {statusFilter && (
              <Text color={theme.info}>status: {statusFilter}</Text>
            )}
            {statusFilter && priorityFilter && <Text dimColor> · </Text>}
            {priorityFilter && (
              <Text color={theme.accent}>priority: {priorityFilter}</Text>
            )}
          </Box>
        )}
      </Box>
    );
  }

  const sidebarVisible = tasks.slice(
    sidebarScrollOffset,
    sidebarScrollOffset + visibleRows,
  );

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      {/* Left sidebar: task list */}
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
        <Box paddingX={1} gap={1}>
          <Text bold dimColor>
            Tasks ({tasks.length})
          </Text>
          {statusFilter && <Text color={theme.info}>[{statusFilter}]</Text>}
          {priorityFilter && (
            <Text color={theme.accent}>[{priorityFilter}]</Text>
          )}
        </Box>
        {sidebarVisible.map((task, vi) => {
          const i = vi + sidebarScrollOffset;
          const isSelected = i === selectedIndex;
          const icon = STATUS_ICONS[task.status];
          const priorityLabel = PRIORITY_LABELS[task.priority];
          const maxName = SIDEBAR_WIDTH - 11; // icon + priority + padding
          const nameDisplay =
            task.name.length > maxName
              ? `${task.name.slice(0, maxName - 1)}…`
              : task.name;
          return (
            <Box key={task.id} paddingX={1}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                bold={isSelected}
                color={isSelected ? theme.info : undefined}
                wrap="truncate-end"
              >
                {isSelected ? "▸" : " "}{" "}
                <Text color={STATUS_COLORS[task.status]} bold={false}>
                  {icon}
                </Text>{" "}
                {nameDisplay}
                <Text
                  color={PRIORITY_COLORS[task.priority]}
                  dimColor={task.priority === "low"}
                >
                  {" "}
                  {priorityLabel}
                </Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Right detail pane */}
      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        overflow="hidden"
      >
        {detailVisible.map((line, i) => {
          const lineNum = detailScroll + i;
          return <Text key={lineNum}>{line || " "}</Text>;
        })}
        {detailLines.length > visibleRows && (
          <Box>
            <Text dimColor>
              f filter · p priority · ↑↓ select · j/k scroll · r refresh · [
              {detailScroll + 1}–
              {Math.min(detailScroll + visibleRows, detailLines.length)} of{" "}
              {detailLines.length}]
            </Text>
          </Box>
        )}
        {detailLines.length <= visibleRows && <Box flexGrow={1} />}
        {detailLines.length <= visibleRows && (
          <Text dimColor>f filter · p priority · ↑↓ select · r refresh</Text>
        )}
      </Box>
    </Box>
  );
}
