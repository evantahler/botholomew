import { Box, Text, useInput, useStdout } from "ink";
import { memo, useEffect, useState } from "react";
import { withDb } from "../../db/connection.ts";
import { listWorkers, type Worker } from "../../db/workers.ts";

interface WorkerPanelProps {
  dbPath: string;
  isActive: boolean;
}

const STATUS_FILTERS: readonly (Worker["status"] | null)[] = [
  null,
  "running",
  "stopped",
  "dead",
];

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

function formatAge(from: Date, now: Date): string {
  const secs = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const WorkerPanel = memo(function WorkerPanel({
  dbPath,
  isActive,
}: WorkerPanelProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterIdx, setFilterIdx] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const status = STATUS_FILTERS[filterIdx] ?? undefined;
      const result = await withDb(dbPath, (conn) =>
        listWorkers(conn, status ? { status } : {}),
      );
      if (mounted) {
        setWorkers(result);
        setNow(new Date());
        setSelectedIndex((prev) =>
          Math.min(prev, Math.max(0, result.length - 1)),
        );
      }
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [dbPath, filterIdx]);

  useInput(
    (input, key) => {
      if (!isActive) return;
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(workers.length - 1, i + 1));
        return;
      }
      if (input === "f") {
        setFilterIdx((i) => (i + 1) % STATUS_FILTERS.length);
        return;
      }
    },
    { isActive },
  );

  const selected = workers[selectedIndex];
  const filterLabel = STATUS_FILTERS[filterIdx] ?? "all";
  const visibleRows = Math.max(4, termRows - 10);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Workers
        </Text>
        <Text dimColor> · filter: </Text>
        <Text color="yellow">{filterLabel}</Text>
        <Text dimColor>{" · [f] cycle filter  [↑↓] select"}</Text>
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
            {workers.slice(0, visibleRows).map((w, i) => {
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
          <Box flexDirection="column" flexGrow={1}>
            {selected ? <WorkerDetail worker={selected} now={now} /> : null}
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
          {worker.started_at.toISOString()}{" "}
          <Text dimColor>({formatAge(worker.started_at, now)} ago)</Text>
        </Text>
        <Text>
          <Text dimColor>Heartbeat</Text>{" "}
          {worker.last_heartbeat_at.toISOString()}{" "}
          <Text dimColor>({formatAge(worker.last_heartbeat_at, now)} ago)</Text>
        </Text>
        {worker.stopped_at && (
          <Text>
            <Text dimColor>Stopped </Text>
            {worker.stopped_at.toISOString()}
          </Text>
        )}
        {worker.task_id && (
          <Text>
            <Text dimColor>Task </Text>
            {worker.task_id}
          </Text>
        )}
      </Box>
    </Box>
  );
}
