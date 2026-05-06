import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteThread,
  getInteractionsAfter,
  getThread,
  type Interaction,
  isThreadEnded,
  listThreads,
  type Thread,
} from "../../threads/store.ts";
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

interface ThreadPanelProps {
  projectDir: string;
  activeThreadId: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;
const PAGE_SCROLL_LINES = 10;

const THREAD_TYPES: readonly Thread["type"][] = [
  "worker_tick",
  "chat_session",
] as const;

const TYPE_LABELS: Record<Thread["type"], string> = {
  worker_tick: "worker",
  chat_session: "chat",
};

const TYPE_ICONS: Record<Thread["type"], string> = {
  worker_tick: "⚙",
  chat_session: "💬",
};

const TYPE_COLORS: Record<Thread["type"], string> = {
  worker_tick: theme.accent,
  chat_session: theme.info,
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
  _isActiveThread: boolean,
): string {
  const lines: string[] = [];

  // Body only — title/type/timing live in the panel header.
  if (thread.task_id) {
    lines.push(
      `${ansi.bold}${ansi.primary}Task${ansi.reset}      ${ansi.dim}${thread.task_id}${ansi.reset}`,
    );
    lines.push("");
  }

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
  projectDir,
  activeThreadId,
  isActive,
}: ThreadPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [typeFilter, setTypeFilter] = useState<Thread["type"] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<{
    thread: Thread;
    interactions: Interaction[];
  } | null>(null);
  const [following, setFollowing] = useState(false);
  const lastSeenSequenceRef = useRef(0);

  // Fetch thread list
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const filters: { type?: Thread["type"] } = {};
      if (typeFilter) filters.type = typeFilter;
      try {
        const result = await listThreads(projectDir, filters);
        if (mounted) {
          setThreads(result);
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
  }, [projectDir, typeFilter, refreshTick]);

  // Filter threads by search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, searchQuery]);

  // Fetch detail for selected thread (skip while following — follow effect handles updates)
  const selectedThread = filteredThreads[selectedIndex];
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedThread?.id is the intentional trigger
  useEffect(() => {
    if (following) return;
    let mounted = true;
    if (!selectedThread) {
      setSelectedDetail(null);
      return;
    }

    getThread(projectDir, selectedThread.id).then((result) => {
      if (mounted && result) {
        setSelectedDetail(result);
      }
    });

    return () => {
      mounted = false;
    };
  }, [projectDir, selectedThread?.id, following]);

  // Follow mode: poll for new interactions every 1s
  // biome-ignore lint/correctness/useExhaustiveDependencies: following and selectedThread?.id are the intentional triggers
  useEffect(() => {
    if (!following || !selectedThread) return;
    let mounted = true;

    const poll = async () => {
      try {
        const newInteractions = await getInteractionsAfter(
          projectDir,
          selectedThread.id,
          lastSeenSequenceRef.current,
        );
        if (!mounted || newInteractions.length === 0) return;

        const maxNewSeq =
          newInteractions[newInteractions.length - 1]?.sequence ?? 0;
        lastSeenSequenceRef.current = maxNewSeq;

        setSelectedDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            interactions: [...prev.interactions, ...newInteractions],
          };
        });

        setDetailScroll(Number.MAX_SAFE_INTEGER);

        const ended = await isThreadEnded(projectDir, selectedThread.id);
        if (mounted && ended) {
          setFollowing(false);
          const result = await getThread(projectDir, selectedThread.id);
          if (mounted && result) {
            setSelectedDetail(result);
          }
        }
      } catch {
        // Transient FS errors — retry next tick
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, following, selectedThread?.id]);

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

  // Reset detail scroll and follow mode when selection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is the intentional trigger
  useEffect(() => {
    setDetailScroll(0);
    setFollowing(false);
  }, [selectedIndex]);

  const forceRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  // Mirror state into refs to dodge Ink's stale-closure bug.
  const itemCountRef = useLatestRef(filteredThreads.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedThreadRef = useLatestRef(selectedThread);
  const selectedDetailRef = useLatestRef(selectedDetail);
  const searchingRef = useLatestRef(searching);
  const isActiveSelectedRef = useLatestRef(isActiveSelected);
  const followingRef = useLatestRef(following);
  const focusRef = useLatestRef(focus);

  const deleteConfirm = useDeleteConfirm(() => {
    const t = selectedThreadRef.current;
    if (!t || isActiveSelectedRef.current) return;
    deleteThread(projectDir, t.id).then(() => {
      forceRefresh();
    });
  });

  useInput(
    (input, key) => {
      // Search mode: capture typed characters
      if (searchingRef.current) {
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
        setTypeFilter((f) => cycleFilter(f, THREAD_TYPES));
        return;
      }
      if (input === "d" && selectedThreadRef.current) {
        if (isActiveSelectedRef.current) return; // Can't delete active thread
        const t = selectedThreadRef.current;
        deleteConfirm.pressDelete(t.title || "(untitled)");
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
      if (input === "w") {
        const t = selectedThreadRef.current;
        if (!t) return;
        if (followingRef.current) {
          setFollowing(false);
        } else if (!t.ended_at) {
          const maxSeq =
            selectedDetailRef.current?.interactions.at(-1)?.sequence ?? 0;
          lastSeenSequenceRef.current = maxSeq;
          setFollowing(true);
          setDetailScroll(maxDetailScrollRef.current);
        }
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
              : "No threads found. Threads will appear as chat sessions and worker ticks occur."}
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
        {...detailPaneBorderProps(focus)}
        overflow="hidden"
      >
        {selectedThread && (
          <ThreadDetailHeader
            thread={selectedThread}
            isActiveThread={isActiveSelected}
          />
        )}
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
        <Box>
          {following && (
            <Text color={theme.success} bold>
              {" "}
              FOLLOWING{" "}
            </Text>
          )}
          <Text dimColor>
            {focus === "detail"
              ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
              : `↑↓ select · → enter detail · s search · f filter · d delete (×2)${selectedThread && !selectedThread.ended_at ? " · w follow" : ""} · r refresh`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});

function ThreadDetailHeader({
  thread,
  isActiveThread,
}: {
  thread: Thread;
  isActiveThread: boolean;
}) {
  return (
    <Box flexDirection="column" width="100%" backgroundColor={theme.headerBg}>
      <Box>
        <Text wrap="truncate-end">
          <Text bold italic color={theme.info}>
            {thread.title || "(untitled)"}
          </Text>
          {isActiveThread && (
            <Text bold color={theme.success}>
              {" ★"}
            </Text>
          )}
        </Text>
      </Box>
      <Box>
        <Text wrap="truncate-end">
          <Text color={TYPE_COLORS[thread.type]}>
            {TYPE_ICONS[thread.type]} {TYPE_LABELS[thread.type]}
          </Text>
          <Text dimColor>
            {" · started "}
            {formatDate(thread.started_at)}
            {" · "}
          </Text>
          {thread.ended_at ? (
            <Text dimColor>ended {formatDate(thread.ended_at)}</Text>
          ) : (
            <Text color={theme.success}>ongoing</Text>
          )}
          <Text dimColor>
            {" · "}
            {formatDuration(thread.started_at, thread.ended_at)}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}
