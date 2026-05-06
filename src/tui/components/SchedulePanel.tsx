import { Box, Text, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Schedule } from "../../schedules/schema.ts";
import {
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from "../../schedules/store.ts";
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

interface SchedulePanelProps {
  projectDir: string;
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

const ENABLED_LABELS: Record<string, string> = {
  true: "enabled",
  false: "disabled",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "(never)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildScheduleDetailAnsi(schedule: Schedule): string {
  const lines: string[] = [];

  // Body only — name/status/frequency/last-run live in the panel header.
  if (schedule.description) {
    lines.push(`${ansi.bold}${ansi.primary}Description${ansi.reset}`);
    lines.push(schedule.description);
    lines.push("");
  }

  lines.push(
    `${ansi.bold}${ansi.primary}Created${ansi.reset}   ${ansi.dim}${formatTimestamp(schedule.created_at)}${ansi.reset}`,
  );
  lines.push(
    `${ansi.bold}${ansi.primary}Updated${ansi.reset}   ${ansi.dim}${formatTimestamp(schedule.updated_at)}${ansi.reset}`,
  );
  lines.push(
    `${ansi.bold}${ansi.primary}ID${ansi.reset}        ${ansi.dim}${schedule.id}${ansi.reset}`,
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
  projectDir,
  isActive,
}: SchedulePanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<FocusState>("list");
  const [enabledFilter, setEnabledFilter] = useState<boolean | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick triggers manual refresh
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const filters: { enabled?: boolean } = {};
      if (enabledFilter !== null) filters.enabled = enabledFilter;
      try {
        const result = await listSchedules(projectDir, filters);
        if (mounted) {
          setSchedules(result);
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
  }, [projectDir, enabledFilter, refreshTick]);

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

  const itemCountRef = useLatestRef(schedules.length);
  const maxDetailScrollRef = useLatestRef(maxDetailScroll);
  const selectedScheduleRef = useLatestRef(selectedSchedule);
  const focusRef = useLatestRef(focus);

  const deleteConfirm = useDeleteConfirm(() => {
    const s = selectedScheduleRef.current;
    if (!s) return;
    deleteSchedule(projectDir, s.id).then(() => {
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
        setEnabledFilter((f) => cycleFilter(f, ENABLED_FILTERS));
        return;
      }
      if (input === "e") {
        const s = selectedScheduleRef.current;
        if (!s) return;
        updateSchedule(projectDir, s.id, {
          enabled: !s.enabled,
        }).then(() => {
          forceRefresh();
        });
        return;
      }
      if (input === "d" && selectedScheduleRef.current) {
        const s = selectedScheduleRef.current;
        deleteConfirm.pressDelete(s.name);
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

      <Box
        flexDirection="column"
        flexGrow={1}
        height={visibleRows + 1}
        paddingX={1}
        {...detailPaneBorderProps(focus)}
        overflow="hidden"
      >
        {selectedSchedule && (
          <ScheduleDetailHeader schedule={selectedSchedule} />
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
        <Text dimColor>
          {focus === "detail"
            ? "↑↓ scroll · ⇧↑↓ page · g/G top/bot · ← back to list"
            : "↑↓ select · → enter detail · f filter · e toggle · d delete (×2) · r refresh"}
        </Text>
      </Box>
    </Box>
  );
});

function ScheduleDetailHeader({ schedule }: { schedule: Schedule }) {
  const enabledKey = String(schedule.enabled);
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={theme.info} wrap="truncate-end">
          {schedule.name}
        </Text>
      </Box>
      <Box>
        <Text wrap="truncate-end">
          <Text color={ENABLED_COLORS[enabledKey]}>
            {ENABLED_ICONS[enabledKey]} {ENABLED_LABELS[enabledKey]}
          </Text>
          <Text dimColor> · </Text>
          <Text color={theme.accent}>{schedule.frequency}</Text>
          <Text dimColor>
            {" · last run "}
            {formatTimestamp(schedule.last_run_at)}
          </Text>
        </Text>
      </Box>
      <Box>
        <Text dimColor>{"─".repeat(2)}</Text>
      </Box>
    </Box>
  );
}
