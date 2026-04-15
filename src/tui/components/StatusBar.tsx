import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { DbConnection } from "../../db/connection.ts";
import { listTasks } from "../../db/tasks.ts";
import { getDaemonStatus } from "../../utils/pid.ts";
import { LogoChar } from "./Logo.tsx";

interface StatusBarProps {
  projectDir: string;
  conn: DbConnection;
  onDaemonStatusChange?: (running: boolean) => void;
}

interface Status {
  daemonRunning: boolean;
  pendingCount: number;
  inProgressCount: number;
}

export function StatusBar({
  projectDir,
  conn,
  onDaemonStatusChange,
}: StatusBarProps) {
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
        const daemonRunning = daemon !== null;
        setStatus({
          daemonRunning,
          pendingCount: pending.length,
          inProgressCount: inProgress.length,
        });
        onDaemonStatusChange?.(daemonRunning);
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, conn, onDaemonStatusChange]);

  return (
    <Box paddingX={0}>
      <LogoChar />
      <Text bold color="blue">
        Botholomew
      </Text>
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
