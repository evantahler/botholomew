import { useEffect, useState } from "react";
import { listApprovals } from "../../approvals/store.ts";

/**
 * Poll the count of pending approvals so the TabBar can render a badge on the
 * Approvals tab regardless of which tab is active. Lightweight: a directory
 * scan every few seconds, mirroring the panel refresh cadence.
 */
export function useApprovalCount(projectDir: string, ready: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const pending = await listApprovals(projectDir, { status: "pending" });
        if (mounted) setCount(pending.length);
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
  }, [projectDir, ready]);

  return count;
}
