import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DbConnection } from "../../db/connection.ts";
import {
  deleteThread,
  getThread,
  type Interaction,
  listThreads,
  type Thread,
} from "../../db/threads.ts";
import { ansi, theme } from "../theme.ts";

interface ThreadPanelProps {
  conn: DbConnection;
  activeThreadId: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;
const PAGE_SCROLL_LINES = 10;

const THREAD_TYPES: readonly Thread["type"][] = [
  "daemon_tick",
  "chat_session",
] as const;

const TYPE_LABELS: Record<Thread["type"], string> = {
  daemon_tick: "daemon",
  chat_session: "agent",
};

const TYPE_ICONS: Record<Thread["type"], string> = {
  daemon_tick: "⚙",
  chat_session: "💬",
};

const TYPE_COLORS: Record<Thread["type"], string> = {
  daemon_tick: theme.accent,
  chat_session: theme.info,
};

const TYPE_ANSI: Record<Thread["type"], string> = {
  daemon_tick: ansi.accent,
  chat_session: ansi.info,
};

const ROLE_ANSI: Record<string, string> = {
  user: ansi.success,
  assistant: ansi.info,
  system: ansi.toolName,
  tool: ansi.accent,
};

function formatDuration(start: Date, end: Date | null): string {
  const endTime = end ?? new Date();
  const ms = endTime.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatDate(d: Date): string {
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildThreadDetailAnsi(
  thread: Thread,
  interactions: Interaction[],
  isActiveThread: boolean,
): string {
  const lines: string[] = [];

  lines.push(
    `${ansi.bold}${ansi.italic}${ansi.info}${thread.title || "(untitled)"}${ansi.reset}`,
  );
  lines.push("");

  const typeAnsi = TYPE_ANSI[thread.type];
  lines.push(
    `${ansi.bold}${ansi.primary}Type${ansi.reset}      ${typeAnsi}${TYPE_ICONS[thread.type]} ${TYPE_LABELS[thread.type]}${ansi.reset}`,
  );

  if (thread.task_id) {
    lines.push(
      `${ansi.bold}${ansi.primary}Task${ansi.reset}      ${ansi.dim}${thread.task_id}${ansi.reset}`,
    );
  }

  lines.push(
    `${ansi.bold}${ansi.primary}Started${ansi.reset}   ${ansi.dim}${formatDate(thread.started_at)}${ansi.reset}`,
  );
  lines.push(
    `${ansi.bold}${ansi.primary}Ended${ansi.reset}     ${thread.ended_at ? `${ansi.dim}${formatDate(thread.ended_at)}${ansi.reset}` : `${ansi.success}ongoing${ansi.reset}`}`,
  );
  lines.push(
    `${ansi.bold}${ansi.primary}Duration${ansi.reset}  ${ansi.dim}${formatDuration(thread.started_at, thread.ended_at)}${ansi.reset}`,
  );

  if (isActiveThread) {
    lines.push("");
    lines.push(
      `${ansi.bold}${ansi.success}★ Current session thread${ansi.reset}`,
    );
  }

  lines.push("");
  lines.push(
    `${ansi.bold}${ansi.primary}Interactions${ansi.reset}  ${interactions.length} total`,
  );

  // Breakdown by role
  const byRole: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const ix of interactions) {
    byRole[ix.role] = (byRole[ix.role] ?? 0) + 1;
    byKind[ix.kind] = (byKind[ix.kind] ?? 0) + 1;
  }

  const roleSummary = Object.entries(byRole)
    .map(
      ([role, count]) =>
        `${ROLE_ANSI[role] ?? ansi.dim}${role}${ansi.reset}: ${count}`,
    )
    .join("  ");
  if (roleSummary) {
    lines.push(`  ${roleSummary}`);
  }

  const kindSummary = Object.entries(byKind)
    .map(([kind, count]) => `${ansi.dim}${kind}${ansi.reset}: ${count}`)
    .join("  ");
  if (kindSummary) {
    lines.push(`  ${kindSummary}`);
  }

  // Condensed interaction timeline
  if (interactions.length > 0) {
    lines.push("");
    lines.push(`${ansi.bold}${ansi.primary}Timeline${ansi.reset}`);
    for (const ix of interactions) {
      const roleColor = ROLE_ANSI[ix.role] ?? ansi.dim;
      const time = ix.created_at.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const preview =
        ix.content.length > 60 ? `${ix.content.slice(0, 57)}...` : ix.content;
      const firstLine = preview.split("\n")[0] ?? "";
      const toolTag = ix.tool_name
        ? ` ${ansi.toolName}[${ix.tool_name}]${ansi.reset}`
        : "";
      lines.push(
        `  ${ansi.dim}${String(ix.sequence).padStart(3)}${ansi.reset} ${roleColor}${ix.role}${ansi.reset} ${ansi.dim}${ix.kind}${ansi.reset}${toolTag} ${ansi.dim}${time}${ansi.reset}`,
      );
      if (firstLine) {
        lines.push(`      ${ansi.dim}${firstLine}${ansi.reset}`);
      }
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

export const ThreadPanel = memo(function ThreadPanel({
  conn,
  activeThreadId,
  isActive,
}: ThreadPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [typeFilter, setTypeFilter] = useState<Thread["type"] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<{
    thread: Thread;
    interactions: Interaction[];
  } | null>(null);

  // Fetch thread list
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const filters: { type?: Thread["type"] } = {};
      if (typeFilter) filters.type = typeFilter;
      const result = await listThreads(conn, filters);
      if (mounted) {
        setThreads(result);
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
  }, [conn, typeFilter, refreshTick]);

  // Filter threads by search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, searchQuery]);

  // Fetch detail for selected thread
  const selectedThread = filteredThreads[selectedIndex];
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedThread?.id is the intentional trigger
  useEffect(() => {
    let mounted = true;
    if (!selectedThread) {
      setSelectedDetail(null);
      return;
    }

    getThread(conn, selectedThread.id).then((result) => {
      if (mounted && result) {
        setSelectedDetail(result);
      }
    });

    return () => {
      mounted = false;
    };
  }, [conn, selectedThread?.id]);

  const isActiveSelected = selectedThread?.id === activeThreadId;

  const renderedDetail = useMemo(() => {
    if (!selectedDetail) return "";
    return buildThreadDetailAnsi(
      selectedDetail.thread,
      selectedDetail.interactions,
      selectedDetail.thread.id === activeThreadId,
    );
  }, [selectedDetail, activeThreadId]);

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
      filteredThreads.length - visibleRows,
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
      // Search mode: capture typed characters
      if (searching) {
        if (key.escape) {
          setSearching(false);
          setSearchQuery("");
          return;
        }
        if (key.return) {
          setSearching(false);
          return;
        }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          setSelectedIndex(0);
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setSearchQuery((q) => q + input);
          setSelectedIndex(0);
          return;
        }
        return;
      }

      // Delete confirmation mode
      if (confirmDelete) {
        if (input === "y" || input === "d") {
          if (selectedThread && !isActiveSelected) {
            deleteThread(conn, selectedThread.id).then(() => {
              forceRefresh();
            });
          }
          setConfirmDelete(false);
        } else {
          setConfirmDelete(false);
        }
        return;
      }

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
          setSelectedIndex((i) => Math.min(filteredThreads.length - 1, i + 1));
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
        setTypeFilter((f) => cycleFilter(f, THREAD_TYPES));
        return;
      }
      if (input === "d" && selectedThread) {
        if (isActiveSelected) return; // Can't delete active thread
        setConfirmDelete(true);
        return;
      }
      if (input === "r") {
        forceRefresh();
        return;
      }
      if (input === "s" || input === "/") {
        setSearching(true);
        setSearchQuery("");
        return;
      }
    },
    { isActive },
  );

  if (filteredThreads.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          {searchQuery
            ? `No threads match "${searchQuery}". Press Escape to clear search.`
            : typeFilter
              ? "No threads match the current filter. Press f to change filter."
              : "No threads found. Threads will appear as chat sessions and daemon ticks occur."}
        </Text>
        {typeFilter && (
          <Box marginTop={1}>
            <Text color={TYPE_COLORS[typeFilter]}>
              {TYPE_ICONS[typeFilter]} {TYPE_LABELS[typeFilter]}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  const sidebarVisible = filteredThreads.slice(
    sidebarScrollOffset,
    sidebarScrollOffset + visibleRows,
  );

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      {/* Left sidebar: thread list */}
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
            Threads ({filteredThreads.length})
          </Text>
          {typeFilter && (
            <Text color={TYPE_COLORS[typeFilter]}>
              [{TYPE_ICONS[typeFilter]} {TYPE_LABELS[typeFilter]}]
            </Text>
          )}
          {!searching && searchQuery && <Text dimColor>🔍 {searchQuery}</Text>}
        </Box>
        {searching && (
          <Box paddingX={1}>
            <Text color={theme.info}>🔍 </Text>
            <Text color={theme.info}>{searchQuery}</Text>
            <Text color={theme.info}>▌</Text>
          </Box>
        )}
        {confirmDelete && selectedThread && (
          <Box paddingX={1}>
            <Text color="red" bold>
              Delete thread? (y/n)
            </Text>
          </Box>
        )}
        {sidebarVisible.map((thread, vi) => {
          const i = vi + sidebarScrollOffset;
          const isSelected = i === selectedIndex;
          const icon = TYPE_ICONS[thread.type];
          const isActive = thread.id === activeThreadId;
          const dateStr = thread.started_at.toLocaleDateString([], {
            month: "short",
            day: "numeric",
          });
          const maxName = SIDEBAR_WIDTH - 15; // icon + date + padding
          const title = thread.title || "(untitled)";
          const nameDisplay =
            title.length > maxName ? `${title.slice(0, maxName - 1)}…` : title;
          return (
            <Box key={thread.id} paddingX={1}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                bold={isSelected}
                color={isSelected ? theme.info : undefined}
                wrap="truncate-end"
              >
                {isSelected ? "▸" : " "}{" "}
                <Text color={TYPE_COLORS[thread.type]} bold={false}>
                  {icon}
                </Text>{" "}
                {nameDisplay}
                {isActive && (
                  <Text color={theme.success} bold={false}>
                    {" "}
                    ★
                  </Text>
                )}
                <Text dimColor bold={false}>
                  {" "}
                  {dateStr}
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
              s search · f filter · ↑↓ select · j/k scroll · d delete · r
              refresh · [{detailScroll + 1}–
              {Math.min(detailScroll + visibleRows, detailLines.length)} of{" "}
              {detailLines.length}]
            </Text>
          </Box>
        )}
        {detailLines.length <= visibleRows && <Box flexGrow={1} />}
        {detailLines.length <= visibleRows && (
          <Text dimColor>
            s search · f filter · ↑↓ select · d delete · r refresh
          </Text>
        )}
      </Box>
    </Box>
  );
});
