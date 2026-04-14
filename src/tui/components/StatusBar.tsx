import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { DbConnection } from "../../db/connection.ts";
import { listTasks } from "../../db/tasks.ts";
import { getDaemonStatus } from "../../utils/pid.ts";

interface StatusBarProps {
  projectDir: string;
  conn: DbConnection;
  isLoading: boolean;
}

interface Status {
  daemonRunning: boolean;
  pendingCount: number;
  inProgressCount: number;
}

export function StatusBar({ projectDir, conn, isLoading }: StatusBarProps) {
  const [status, setStatus] = useState<Status>({
    daemonRunning: false,
    pendingCount: 0,
    inProgressCount: 0,
  });

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const daemon = await getDaemonStatus(projectDir);
      const pending = await listTasks(conn, { status: "pending" });
      const inProgress = await listTasks(conn, { status: "in_progress" });
      if (mounted) {
        setStatus({
          daemonRunning: daemon !== null,
          pendingCount: pending.length,
          inProgressCount: inProgress.length,
        });
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, conn]);

  return (
    <Box paddingX={0}>
      <Text bold color="blue">
        Botholomew
      </Text>
      <Text dimColor> | </Text>
      {isLoading ? (
        <Text color="yellow">Working...</Text>
      ) : (
        <Text color="green">Ready</Text>
      )}
      <Text dimColor> | </Text>
      {status.daemonRunning ? (
        <Text color="green">Daemon</Text>
      ) : (
        <Text color="red">Daemon (off)</Text>
      )}
      <Text dimColor> | </Text>
      <Text>
        {status.pendingCount} pending, {status.inProgressCount} active
      </Text>
    </Box>
  );
}
