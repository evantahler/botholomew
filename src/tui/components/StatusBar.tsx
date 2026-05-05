import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { listTasks } from "../../tasks/store.ts";
import { listWorkers } from "../../workers/store.ts";
import { LogoChar } from "./Logo.tsx";

interface StatusBarProps {
  projectDir: string;
  /**
   * Retained for callers that pass it; unused now that workers + tasks
   * both live on disk. Drop on the next TUI cleanup pass.
   */
  dbPath?: string;
  chatTitle?: string;
  onWorkerStatusChange?: (running: boolean) => void;
}

interface Status {
  workerCount: number;
  pendingCount: number;
  inProgressCount: number;
}

export function StatusBar({
  projectDir,
  dbPath: _dbPath,
  chatTitle,
  onWorkerStatusChange,
}: StatusBarProps) {
  const [status, setStatus] = useState<Status>({
    workerCount: 0,
    pendingCount: 0,
    inProgressCount: 0,
  });

  useEffect(() => {
    let mounted = true;

    // Errors here (e.g. transient DuckDB lock conflicts while a freshly
    // spawned worker is migrating) must not freeze the count — the next
    // interval tick will retry. Swallow silently rather than logging
    // because logger writes to stdout and would corrupt the Ink render.
    const refresh = async () => {
      try {
        const [pending, inProgress, workers] = await Promise.all([
          listTasks(projectDir, { status: "pending" }),
          listTasks(projectDir, { status: "in_progress" }),
          listWorkers(projectDir, { status: "running" }),
        ]);
        if (mounted) {
          setStatus({
            workerCount: workers.length,
            pendingCount: pending.length,
            inProgressCount: inProgress.length,
          });
          onWorkerStatusChange?.(workers.length > 0);
        }
      } catch {
        // Keep prior state; next tick will retry.
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectDir, onWorkerStatusChange]);

  return (
    <Box paddingX={0}>
      <LogoChar />
      <Text bold color="blue">
        Botholomew
      </Text>
      {chatTitle && (
        <>
          <Text dimColor> | </Text>
          <Text color="cyan" bold italic>
            {chatTitle.length > 30 ? `${chatTitle.slice(0, 29)}…` : chatTitle}
          </Text>
        </>
      )}
      <Text dimColor> | </Text>
      {status.workerCount > 0 ? (
        <Text color="green">
          {status.workerCount} worker{status.workerCount === 1 ? "" : "s"}
        </Text>
      ) : (
        <Text color="yellow">no workers</Text>
      )}
      <Text dimColor> | </Text>
      <Text>
        {status.pendingCount} pending, {status.inProgressCount} active
      </Text>
    </Box>
  );
}
