import { Box } from "ink";
import type { ContextUsage } from "../../chat/usage.ts";
import { ContextPanel } from "./ContextPanel.tsx";
import { HelpPanel } from "./HelpPanel.tsx";
import { SchedulePanel } from "./SchedulePanel.tsx";
import type { TabId } from "./TabBar.tsx";
import { TaskPanel } from "./TaskPanel.tsx";
import { ThreadPanel } from "./ThreadPanel.tsx";
import type { ToolCallData } from "./ToolCall.tsx";
import { ToolPanel } from "./ToolPanel.tsx";
import { WorkerPanel } from "./WorkerPanel.tsx";

interface TabPanelsProps {
  activeTab: TabId;
  projectDir: string;
  threadId: string;
  allToolCalls: ToolCallData[];
  workerRunning: boolean;
  usage: ContextUsage | null;
}

// Tabs 2–8. The chat tab (1) is structurally different (`maxHeight` clipping,
// streaming props) and stays inline in App.tsx. All panels stay mounted to
// avoid expensive remount cycles — `display="none"` hides inactive panels
// from layout without destroying them.
//
// `flexGrow={1}` fills the root (which is pinned to `rows` on these tabs)
// minus the footer's actual height, so the panel always reaches the top of
// the viewport — no scrollback leak above the panel regardless of footer
// height.
export function TabPanels({
  activeTab,
  projectDir,
  threadId,
  allToolCalls,
  workerRunning,
  usage,
}: TabPanelsProps) {
  return (
    <>
      <Box
        display={activeTab === 2 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <ToolPanel toolCalls={allToolCalls} isActive={activeTab === 2} />
      </Box>
      <Box
        display={activeTab === 3 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <ContextPanel projectDir={projectDir} isActive={activeTab === 3} />
      </Box>
      <Box
        display={activeTab === 4 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <TaskPanel projectDir={projectDir} isActive={activeTab === 4} />
      </Box>
      <Box
        display={activeTab === 5 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <ThreadPanel
          projectDir={projectDir}
          activeThreadId={threadId}
          isActive={activeTab === 5}
        />
      </Box>
      <Box
        display={activeTab === 6 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <SchedulePanel projectDir={projectDir} isActive={activeTab === 6} />
      </Box>
      <Box
        display={activeTab === 7 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <WorkerPanel projectDir={projectDir} isActive={activeTab === 7} />
      </Box>
      <Box
        display={activeTab === 8 ? "flex" : "none"}
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
      >
        <HelpPanel
          projectDir={projectDir}
          threadId={threadId}
          workerRunning={workerRunning}
          usage={usage}
        />
      </Box>
    </>
  );
}
