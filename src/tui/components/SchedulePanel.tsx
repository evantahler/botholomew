import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { withDb } from "../../db/connection.ts";
import {
  deleteSchedule,
  listSchedules,
  type Schedule,
  updateSchedule,
} from "../../db/schedules.ts";
import { ansi, theme } from "../theme.ts";

interface SchedulePanelProps {
  dbPath: string;
  isActive: boolean;
}

const SIDEBAR_WIDTH = 42;
const PAGE_SCROLL_LINES = 10;

const ENABLED_FILTERS: readonly boolean[] = [true, false] as const;

const ENABLED_ICONS: Record<string, string> = {
  true: "●",
  false: "○",
};

const ENABLED_COLORS: Record<string, string> = {
  true: theme.success,
  false: theme.muted,
};

const ENABLED_ANSI: Record<string, string> = {
  true: ansi.success,
  false: ansi.muted,
};

const ENABLED_LABELS: Record<string, string> = {
  true: "enabled",
  false: "disabled",
};

function buildScheduleDetailAnsi(schedule: Schedule): string {
  const lines: string[] = [];

  lines.push(`${ansi.bold}${ansi.info}${schedule.name}${ansi.reset}`);
  lines.push("");

  const enabledKey = String(schedule.enabled);
  const statusAnsi = ENABLED_ANSI[enabledKey];
  lines.push(
    `${ansi.bold}${ansi.primary}Status${ansi.reset}      ${statusAnsi}${ENABLED_ICONS[enabledKey]} ${ENABLED_LABELS[enabledKey]}${ansi.reset}`,
  );

  lines.push(
    `${ansi.bold}${ansi.primary}Frequency${ansi.reset}   ${ansi.accent}${schedule.frequency}${ansi.reset}`,
  );

  const created = schedule.created_at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const updated = schedule.updated_at.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  lines.push(
    `${ansi.bold}${ansi.primary}Created${ansi.reset}     ${ansi.dim}${created}${ansi.reset}`,
  );
  lines.push(
    `${ansi.bold}${ansi.primary}Updated${ansi.reset}     ${ansi.dim}${updated}${ansi.reset}`,
  );

  const lastRunDisplay = schedule.last_run_at
    ? schedule.last_run_at.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "(never)";
  lines.push(
    `${ansi.bold}${ansi.primary}Last Run${ansi.reset}    ${lastRunDisplay}`,
  );
  lines.push("");

  if (schedule.description) {
    lines.push(`${ansi.bold}${ansi.primary}Description${ansi.reset}`);
    lines.push(schedule.description);
    lines.push("");
  }

  lines.push(
    `${ansi.bold}${ansi.primary}ID${ansi.reset}          ${ansi.dim}${schedule.id}${ansi.reset}`,
  );

  return lines.join("\n");
}

function cycleFilter<T>(current: T | null, values: readonly T[]): T | null {
  if (current === null) return values[0] ?? null;
  const idx = values.indexOf(current);
  if (idx === -1 || idx === values.length - 1) return null;
  return values[idx + 1] ?? null;
}

export const SchedulePanel = memo(function SchedulePanel({
  dbPath,
  isActive,
}: SchedulePanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [enabledFilter, setEnabledFilter] = useState<boolean | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const filters: { enabled?: boolean } = {};
      if (enabledFilter !== null) filters.enabled = enabledFilter;
      const result = await withDb(dbPath, (conn) =>
        listSchedules(conn, filters),
      );
      if (mounted) {
        setSchedules(result);
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
  }, [dbPath, enabledFilter, refreshTick]);

  const selectedSchedule = schedules[selectedIndex];

  const renderedDetail = useMemo(() => {
    if (!selectedSchedule) return "";
    return buildScheduleDetailAnsi(selectedSchedule);
  }, [selectedSchedule]);

  const detailLines = useMemo(
    () => renderedDetail.split("\n"),
    [renderedDetail],
  );

  const visibleRows = Math.max(1, termRows - 6);
  const maxDetailScroll = Math.max(0, detailLines.length - visibleRows);
  const sidebarItems = Math.max(1, Math.floor((visibleRows - 1) / 2));
  const sidebarScrollOffset = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(sidebarItems / 2),
      schedules.length - sidebarItems,
    ),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is the intentional trigger
  useEffect(() => {
    setDetailScroll(0);
  }, [selectedIndex]);

  const forceRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useInput(
    (input, key) => {
      // Delete confirmation mode
      if (confirmDelete) {
        if (input === "y" || input === "d") {
          if (selectedSchedule) {
            withDb(dbPath, (conn) =>
              deleteSchedule(conn, selectedSchedule.id),
            ).then(() => {
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
          setSelectedIndex((i) => Math.min(schedules.length - 1, i + 1));
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
        setEnabledFilter((f) => cycleFilter(f, ENABLED_FILTERS));
        return;
      }
      if (input === "e" && selectedSchedule) {
        withDb(dbPath, (conn) =>
          updateSchedule(conn, selectedSchedule.id, {
            enabled: !selectedSchedule.enabled,
          }),
        ).then(() => {
          forceRefresh();
        });
        return;
      }
      if (input === "d" && selectedSchedule) {
        setConfirmDelete(true);
        return;
      }
      if (input === "r") {
        forceRefresh();
        return;
      }
    },
    { isActive },
  );

  if (schedules.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>
          {enabledFilter !== null
            ? "No schedules match the current filter. Press f to change filter."
            : "No schedules found. Schedules will appear here as they are created."}
        </Text>
        {enabledFilter !== null && (
          <Box marginTop={1}>
            <Text color={ENABLED_COLORS[String(enabledFilter)]}>
              {ENABLED_ICONS[String(enabledFilter)]}{" "}
              {ENABLED_LABELS[String(enabledFilter)]}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  const sidebarVisible = schedules.slice(
    sidebarScrollOffset,
    sidebarScrollOffset + sidebarItems,
  );

  const detailVisible = detailLines.slice(
    detailScroll,
    detailScroll + visibleRows,
  );

  return (
    <Box flexGrow={1} height={visibleRows + 1} overflow="hidden">
      {/* Left sidebar: schedule list */}
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
            Schedules ({schedules.length})
          </Text>
          {enabledFilter !== null && (
            <Text color={ENABLED_COLORS[String(enabledFilter)]}>
              [{ENABLED_LABELS[String(enabledFilter)]}]
            </Text>
          )}
        </Box>
        {confirmDelete && selectedSchedule && (
          <Box paddingX={1}>
            <Text color="red" bold>
              Delete schedule? (y/n)
            </Text>
          </Box>
        )}
        {sidebarVisible.map((schedule, vi) => {
          const i = vi + sidebarScrollOffset;
          const isSelected = i === selectedIndex;
          const enabledKey = String(schedule.enabled);
          const maxName = SIDEBAR_WIDTH - 6;
          const nameDisplay =
            schedule.name.length > maxName
              ? `${schedule.name.slice(0, maxName - 1)}…`
              : schedule.name;
          return (
            <Box key={schedule.id} flexDirection="column" paddingX={1}>
              <Text
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                bold={isSelected}
                color={isSelected ? theme.info : undefined}
                wrap="truncate-end"
              >
                {isSelected ? "▸" : " "}{" "}
                <Text color={ENABLED_COLORS[enabledKey]} bold={false}>
                  {ENABLED_ICONS[enabledKey]}
                </Text>{" "}
                {nameDisplay}
              </Text>
              <Text dimColor wrap="truncate-end">
                {"    "}
                {schedule.frequency}
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
              f filter · e toggle · ↑↓ select · j/k scroll · d delete · r
              refresh · [{detailScroll + 1}–
              {Math.min(detailScroll + visibleRows, detailLines.length)} of{" "}
              {detailLines.length}]
            </Text>
          </Box>
        )}
        {detailLines.length <= visibleRows && <Box flexGrow={1} />}
        {detailLines.length <= visibleRows && (
          <Text dimColor>
            f filter · e toggle · ↑↓ select · d delete · r refresh
          </Text>
        )}
      </Box>
    </Box>
  );
});
