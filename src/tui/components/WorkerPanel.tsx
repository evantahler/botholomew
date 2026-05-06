import { Box, Text, useInput, useStdout } from "ink";
import { memo, useEffect, useMemo, useState } from "react";
import { readLogTail } from "../../worker/log-reader.ts";
import { listWorkers, type Worker } from "../../workers/store.ts";
import {
  detailPaneBorderProps,
  type FocusState,
  handleListDetailKey,
} from "../listDetailKeys.ts";
import { useLatestRef } from "../useLatestRef.ts";
import { Scrollbar } from "./Scrollbar.tsx";

interface WorkerPanelProps {
  projectDir: string;
  isActive: boolean;
}

const STATUS_FILTERS: readonly (Worker["status"] | null)[] = [
  null,
  "running",
  "stopped",
  "dead",
];

const PAGE_SCROLL_LINES = 10;
const LOG_POLL_MS = 1500;

function statusColor(status: Worker["status"]): string {
  switch (status) {
    case "running":
      return "green";
    case "stopped":
      return "gray";
    case "dead":
      return "red";
  }
}

function formatAge(fromIso: string, now: Date): string {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return "?";
  const secs = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export const WorkerPanel = memo(function WorkerPanel({
  projectDir,
  isActive,
}: WorkerPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterIdx, setFilterIdx] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<"detail" | "log">("detail");
  const [logContent, setLogContent] = useState("");
  const [logSize, setLogSize] = useState(0);
  const [logTruncated, setLogTruncated] = useState(false);
  const [logScroll, setLogScroll] = useState(0);
  const [logFollow, setLogFollow] = useState(true);
  const [focus, setFocus] = useState<FocusState>("list");

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const status = STATUS_FILTERS[filterIdx] ?? undefined;
      try {
        const result = await listWorkers(projectDir, status ? { status } : {});
        if (mounted) {
          setWorkers(result);
          setNow(new Date());
          setSelectedIndex((prev) =>
            Math.min(prev, Math.max(0, result.length - 1)),
          );
        }
      } catch {
        // ignore — next tick retries
      }
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, filterIdx]);

  const selected = workers[selectedIndex];
  const selectedLogPath = selected?.log_path ?? null;

  useEffect(() => {
    if (viewMode !== "log" || !selectedLogPath) return;
    let mounted = true;

    const refresh = async () => {
      try {
        const tail = await readLogTail(selectedLogPath);
        if (!mounted) return;
        setLogContent(tail.content);
        setLogSize(tail.size);
        setLogTruncated(tail.truncated);
      } catch {
        // Ignore transient read errors; next tick will retry.
      }
    };

    refresh();
    const interval = setInterval(refresh, LOG_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [viewMode, selectedLogPath]);

  // Reset log scroll + content when the selection or view mode changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset triggers
  useEffect(() => {
    setLogScroll(0);
    setLogFollow(true);
    setLogContent("");
    setLogSize(0);
    setLogTruncated(false);
  }, [selected?.id, viewMode]);

  const logLines = useMemo(() => {
    if (logContent.length === 0) return [];
    // Trim a single trailing newline so the rendered list doesn't end with a
    // blank row, but preserve internal blank lines.
    const trimmed = logContent.endsWith("\n")
      ? logContent.slice(0, -1)
      : logContent;
    return trimmed.split("\n");
  }, [logContent]);

  const visibleRows = Math.max(4, termRows - 8);
  const maxLogScroll = Math.max(0, logLines.length - visibleRows);

  // When following, snap scroll to the bottom whenever new log content
  // arrives. The user can break follow mode by scrolling up; pressing G or
  // running off the end via j/J resumes it.
  useEffect(() => {
    if (viewMode === "log" && logFollow) {
      setLogScroll(maxLogScroll);
    }
  }, [viewMode, logFollow, maxLogScroll]);

  const itemCountRef = useLatestRef(workers.length);
  const maxLogScrollRef = useLatestRef(maxLogScroll);
  const focusRef = useLatestRef(focus);

  // The right pane scrolls with arrows when focused. Tee the log scroll into
  // the follow-state so reaching the bottom resumes follow mode (and any
  // explicit scroll-up pauses it).
  const setLogScrollWithFollow = (
    next: number | ((prev: number) => number),
  ) => {
    setLogScroll((s) => {
      const v = typeof next === "function" ? next(s) : next;
      const max = maxLogScrollRef.current;
      const clamped = Math.max(0, Math.min(max, v));
      setLogFollow(clamped >= max);
      return clamped;
    });
  };

  useInput(
    (input, key) => {
      if (!isActive) return;

      // `l` toggles between detail (worker info) and log (tail) view in the
      // right pane.
      if (input === "l") {
        setViewMode((m) => (m === "log" ? "detail" : "log"));
        return;
      }

      if (
        handleListDetailKey(input, key, {
          focusRef,
          setFocus,
          itemCountRef,
          maxDetailScrollRef: maxLogScrollRef,
          setSelectedIndex,
          setDetailScroll: setLogScrollWithFollow,
          pageScrollLines: PAGE_SCROLL_LINES,
        })
      ) {
        return;
      }

      if (input === "f") {
        setFilterIdx((i) => (i + 1) % STATUS_FILTERS.length);
        return;
      }
    },
    { isActive },
  );

  const filterLabel = STATUS_FILTERS[filterIdx] ?? "all";
  const visibleSidebarRows = Math.max(4, termRows - 10);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Workers
        </Text>
        <Text dimColor> · filter: </Text>
        <Text color="yellow">{filterLabel}</Text>
        <Text dimColor>
          {focus === "detail"
            ? "  · ↑↓ scroll  ⇧↑↓ page  g/G top/bot  ← back to list  l toggle"
            : viewMode === "log"
              ? "  · ↑↓ select  → enter log  l detail  f filter"
              : "  · ↑↓ select  → enter detail  l view log  f filter"}
        </Text>
      </Box>

      {workers.length === 0 ? (
        <Text dimColor>
          No workers
          {filterLabel !== "all" ? ` with status "${filterLabel}"` : ""}.{"\n"}
          Start one with{" "}
          <Text color="green">botholomew worker start --persist</Text>.
        </Text>
      ) : (
        <Box flexDirection="row" flexGrow={1}>
          <Box
            flexDirection="column"
            width={44}
            marginRight={2}
            overflow="hidden"
          >
            {workers.slice(0, visibleSidebarRows).map((w, i) => {
              const active = i === selectedIndex;
              const short = w.id.slice(0, 8);
              return (
                <Box key={w.id}>
                  <Text
                    color={active ? "cyan" : undefined}
                    bold={active}
                    backgroundColor={active ? "#1a3a5c" : undefined}
                  >
                    {active ? "›" : " "}{" "}
                  </Text>
                  <Text
                    color={statusColor(w.status)}
                    dimColor={!active && w.status !== "running"}
                  >
                    {w.status.padEnd(8)}
                  </Text>
                  <Text dimColor> </Text>
                  <Text>{short}</Text>
                  <Text dimColor>{` ${w.mode.padEnd(7)}`}</Text>
                  <Text dimColor>{formatAge(w.last_heartbeat_at, now)}</Text>
                </Box>
              );
            })}
          </Box>
          <Box
            flexDirection="row"
            flexGrow={1}
            paddingX={1}
            {...detailPaneBorderProps(focus)}
          >
            <Box flexDirection="column" flexGrow={1}>
              {selected ? (
                viewMode === "log" ? (
                  <WorkerLogView
                    worker={selected}
                    lines={logLines}
                    scroll={logScroll}
                    visibleRows={visibleRows}
                    truncated={logTruncated}
                    size={logSize}
                    follow={logFollow}
                  />
                ) : (
                  <WorkerDetail worker={selected} now={now} />
                )
              ) : null}
            </Box>
            {viewMode === "log" && (
              <Scrollbar
                total={logLines.length}
                visible={visibleRows - 1}
                offset={logScroll}
                height={visibleRows - 1}
                focused={focus === "detail"}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
});

function WorkerDetail({ worker, now }: { worker: Worker; now: Date }) {
  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        {worker.id}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text dimColor>Status </Text>
          <Text color={statusColor(worker.status)}>{worker.status}</Text>
        </Text>
        <Text>
          <Text dimColor>Mode </Text>
          {worker.mode}
        </Text>
        <Text>
          <Text dimColor>PID </Text>
          {worker.pid}
        </Text>
        <Text>
          <Text dimColor>Host </Text>
          {worker.hostname}
        </Text>
        <Text>
          <Text dimColor>Started </Text>
          {worker.started_at}{" "}
          <Text dimColor>({formatAge(worker.started_at, now)} ago)</Text>
        </Text>
        <Text>
          <Text dimColor>Heartbeat</Text> {worker.last_heartbeat_at}{" "}
          <Text dimColor>({formatAge(worker.last_heartbeat_at, now)} ago)</Text>
        </Text>
        {worker.stopped_at && (
          <Text>
            <Text dimColor>Stopped </Text>
            {worker.stopped_at}
          </Text>
        )}
        {worker.task_id && (
          <Text>
            <Text dimColor>Task </Text>
            {worker.task_id}
          </Text>
        )}
        {worker.log_path && (
          <Text>
            <Text dimColor>Log </Text>
            <Text dimColor>{worker.log_path}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

function WorkerLogView({
  worker,
  lines,
  scroll,
  visibleRows,
  truncated,
  size,
  follow,
}: {
  worker: Worker;
  lines: string[];
  scroll: number;
  visibleRows: number;
  truncated: boolean;
  size: number;
  follow: boolean;
}) {
  if (!worker.log_path) {
    return (
      <Box flexDirection="column">
        <Text bold color="blue">
          {worker.id}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            No log file (worker is running in foreground or was started before
            per-worker logs existed).
          </Text>
        </Box>
      </Box>
    );
  }

  if (lines.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="blue">
          {worker.id}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Log empty.</Text>
        </Box>
      </Box>
    );
  }

  const visible = lines.slice(scroll, scroll + visibleRows);
  const lastLine = Math.min(scroll + visibleRows, lines.length);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text bold color="blue">
          {worker.id.slice(0, 8)}
        </Text>
        <Text dimColor>
          {" "}
          · {formatBytes(size)}
          {truncated ? " (tail only)" : ""} ·{" "}
        </Text>
        <Text color={follow ? "green" : "yellow"}>
          {follow ? "following" : "paused"}
        </Text>
        <Text dimColor>
          {"  "}[{scroll + 1}–{lastLine} of {lines.length}]
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((line, i) => {
          const lineNum = scroll + i;
          return <Text key={lineNum}>{line || " "}</Text>;
        })}
      </Box>
    </Box>
  );
}
