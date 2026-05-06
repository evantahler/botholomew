import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { TabId } from "../components/TabBar.tsx";

// Capture-mode tab auto-cycle. Under VHS/ttyd the Tab key doesn't reliably
// reach Ink, so a docs tape can't drive the tab tour by keystroke. When
// BOTHOLOMEW_CAPTURE_TAB_CYCLE is set, schedule timers that walk through
// every tab so a single recording can show all panels.
//
// Format: "dwellMs" or "dwellMs:startDelayMs". The optional start delay
// lets a tape finish a streamed chat reply before the cycle kicks in.
export function useCaptureTabCycle(
  setActiveTab: Dispatch<SetStateAction<TabId>>,
): void {
  useEffect(() => {
    const spec = process.env.BOTHOLOMEW_CAPTURE_TAB_CYCLE;
    if (!spec) return;
    const [dwellRaw, delayRaw] = spec.split(":");
    const dwellMs = Number.parseInt(dwellRaw ?? "", 10) || 2500;
    const startDelayMs = Number.parseInt(delayRaw ?? "", 10) || 0;
    const sequence: TabId[] = [2, 3, 4, 5, 6, 7, 8, 1];
    const timers = sequence.map((tab, i) =>
      setTimeout(() => setActiveTab(tab), startDelayMs + dwellMs * (i + 1)),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [setActiveTab]);
}
