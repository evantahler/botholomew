import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "../../tasks/schema.ts";
import { deleteTask, listTasks } from "../../tasks/store.ts";
import {
  detailPaneBorderProps,
  type FocusState,
  handleListDetailKey,
} from "../listDetailKeys.ts";
import { ansi, theme } from "../theme.ts";
import { useDeleteConfirm } from "../useDeleteConfirm.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { DeleteArmedBanner } from "./DeleteArmedBanner.tsx";
import { Scrollbar } from "./Scrollbar.tsx";

interface TaskPanelProps {
  projectDir: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;
const PAGE_SCROLL_LINES = 10;

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

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTaskDetailAnsi(task: Task): string {
  const lines: string[] = [];

  // Body only — name/status/priority/claim/timestamps are rendered in the
  // panel header.
  lines.push(
    `${ansi.bold}${ansi.primary}Claimed${ansi.reset}   ${task.claimed_by ? task.claimed_by : `${ansi.dim}(unclaimed)${ansi.reset}`}`,
  );
  lines.push("");

  if (task.description) {
    lines.push(`${ansi.bold}${ansi.primary}Description${ansi.reset}`);
    lines.push(task.description);
    lines.push("");
  }

  if (task.status === "waiting" && task.waiting_reason) {
    lines.push(`${ansi.bold}${ansi.primary}Waiting Reason${ansi.reset}`);
    lines.push(`${ansi.accent}${task.waiting_reason}${ansi.reset}`);
    lines.push("");
  }

  if (task.output) {
    lines.push(`${ansi.bold}${ansi.primary}Output${ansi.reset}`);
    lines.push(`${ansi.dim}${task.output}${ansi.reset}`);
    lines.push("");
  }

  if (task.blocked_by.length > 0) {
    lines.push(`${ansi.bold}${ansi.primary}Blocked By${ansi.reset}`);
    for (const id of task.blocked_by) {
      lines.push(`  ${ansi.dim}• ${id}${ansi.reset}`);
    }
    lines.push("");
  }

  if (task.context_paths.length > 0) {
    lines.push(`${ansi.bold}${ansi.primary}Context Paths${ansi.reset}`);
    for (const p of task.context_paths) {
      lines.push(`  ${ansi.dim}• ${p}${ansi.reset}`);
    }
  }

  return lines.join("\n");
}

function cycleFilter<T>(current: T | null, values: readonly T[]): T | null {
  if (current === null) return values[0] ?? null;
  const idx = values.indexOf(current);
  if (idx === -1 || idx === values.length - 1) return null;
  return values[idx + 1] ?? null;
}

export const TaskPanel = memo(function TaskPanel({
  projectDir,
  isActive,
}: TaskPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [statusFilter, setStatusFilter] = useState<Task["status"] | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Task["priority"] | null>(
    null,
  );
  const [refreshTick, setRefreshTick] = useState(0);

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
      try {
        const result = await listTasks(projectDir, filters);
        if (mounted) {
          setTasks(result);
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
  }, [projectDir, statusFilter, priorityFilter, refreshTick]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is the intentional trigger
  useEffect(() => {
    setDetailScroll(0);
  }, [selectedIndex]);

  const forceRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const itemCountRef = useLatestRef(tasks.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedTaskRef = useLatestRef(selectedTask);
  const focusRef = useLatestRef(focus);

  const deleteConfirm = useDeleteConfirm(() => {
    const t = selectedTaskRef.current;
    if (!t) return;
    deleteTask(projectDir, t.id).then(() => {
      forceRefresh();
    });
  });

  useInput(
    (input, key) => {
      if (input !== "d") deleteConfirm.cancel();

      if (
        handleListDetailKey(input, key, {
          focusRef,
          setFocus,
          itemCountRef,
          maxDetailScrollRef,
          setSelectedIndex,
          setDetailScroll,
          pageScrollLines: PAGE_SCROLL_LINES,
        })
      ) {
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
      if (input === "d") {
        const t = selectedTaskRef.current;
        if (!t) return;
        deleteConfirm.pressDelete(t.name || t.id);
        return;
      }
      if (key.ctrl && (input === "r" || input === "R")) {
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
          const maxName = SIDEBAR_WIDTH - 11;
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

      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        {...detailPaneBorderProps(focus)}
        overflow="hidden"
      >
        {selectedTask && <TaskDetailHeader task={selectedTask} />}
        <Box flexDirection="row" flexGrow={1} overflow="hidden">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {detailVisible.map((line, i) => {
              const lineNum = detailScroll + i;
              return (
                <Text key={lineNum} wrap="truncate-end">
                  {line || " "}
                </Text>
              );
            })}
          </Box>
          <Scrollbar
            total={detailLines.length}
            visible={visibleRows - 3}
            offset={detailScroll}
            height={visibleRows - 3}
            focused={focus === "detail"}
          />
        </Box>
        <DeleteArmedBanner
          armed={deleteConfirm.armed}
          label={deleteConfirm.armedLabel}
        />
        <Text dimColor>
          {focus === "detail"
            ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
            : "↑↓ select · → enter detail · f filter · p priority · d delete (×2) · ^R refresh"}
        </Text>
      </Box>
    </Box>
  );
});

function TaskDetailHeader({ task }: { task: Task }) {
  return (
    <Box flexDirection="column" width="100%" backgroundColor={theme.headerBg}>
      <Box>
        <Text bold color={theme.info} wrap="truncate-end">
          {task.name}
        </Text>
      </Box>
      <Box>
        <Text wrap="truncate-end">
          <Text color={STATUS_COLORS[task.status]}>
            {STATUS_ICONS[task.status]} {task.status}
          </Text>
          <Text dimColor> · </Text>
          <Text color={PRIORITY_COLORS[task.priority]}>
            {PRIORITY_LABELS[task.priority]}
          </Text>
          <Text dimColor>
            {" · created "}
            {formatTimestamp(task.created_at)}
            {" · updated "}
            {formatTimestamp(task.updated_at)}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}
