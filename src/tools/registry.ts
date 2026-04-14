// Context tools
import { searchContextTool } from "./context/search.ts";
import { updateBeliefsTool } from "./context/update-beliefs.ts";
import { updateGoalsTool } from "./context/update-goals.ts";
// Directory tools
import { dirCreateTool } from "./dir/create.ts";
import { dirListTool } from "./dir/list.ts";
import { dirSizeTool } from "./dir/size.ts";
import { dirTreeTool } from "./dir/tree.ts";
import { fileCopyTool } from "./file/copy.ts";
import { fileCountLinesTool } from "./file/count-lines.ts";
import { fileDeleteTool } from "./file/delete.ts";
import { fileEditTool } from "./file/edit.ts";
import { fileExistsTool } from "./file/exists.ts";
import { fileInfoTool } from "./file/info.ts";
import { fileMoveTool } from "./file/move.ts";
// File tools
import { fileReadTool } from "./file/read.ts";
import { fileWriteTool } from "./file/write.ts";
// MCP tools
import { mcpExecTool } from "./mcp/exec.ts";
import { mcpInfoTool } from "./mcp/info.ts";
import { mcpListToolsTool } from "./mcp/list-tools.ts";
import { mcpSearchTool } from "./mcp/search.ts";
// Schedule tools
import { createScheduleTool } from "./schedule/create.ts";
import { listSchedulesTool } from "./schedule/list.ts";
// Search tools
import { searchGrepTool } from "./search/grep.ts";
import { searchSemanticTool } from "./search/semantic.ts";
// Task tools
import { completeTaskTool } from "./task/complete.ts";
import { createTaskTool } from "./task/create.ts";
import { failTaskTool } from "./task/fail.ts";
import { listTasksTool } from "./task/list.ts";
import { viewTaskTool } from "./task/view.ts";
import { waitTaskTool } from "./task/wait.ts";
// Thread tools
import { listThreadsTool } from "./thread/list.ts";
import { viewThreadTool } from "./thread/view.ts";
import { registerTool } from "./tool.ts";

export function registerAllTools(): void {
  // Task
  registerTool(completeTaskTool);
  registerTool(failTaskTool);
  registerTool(waitTaskTool);
  registerTool(createTaskTool);
  registerTool(listTasksTool);
  registerTool(viewTaskTool);

  // Directory
  registerTool(dirCreateTool);
  registerTool(dirListTool);
  registerTool(dirTreeTool);
  registerTool(dirSizeTool);

  // File
  registerTool(fileReadTool);
  registerTool(fileWriteTool);
  registerTool(fileEditTool);
  registerTool(fileDeleteTool);
  registerTool(fileCopyTool);
  registerTool(fileMoveTool);
  registerTool(fileInfoTool);
  registerTool(fileExistsTool);
  registerTool(fileCountLinesTool);

  // Schedule
  registerTool(createScheduleTool);
  registerTool(listSchedulesTool);

  // Search
  registerTool(searchGrepTool);
  registerTool(searchSemanticTool);

  // Thread
  registerTool(listThreadsTool);
  registerTool(viewThreadTool);

  // Context
  registerTool(searchContextTool);
  registerTool(updateBeliefsTool);
  registerTool(updateGoalsTool);

  // MCP
  registerTool(mcpListToolsTool);
  registerTool(mcpSearchTool);
  registerTool(mcpInfoTool);
  registerTool(mcpExecTool);
}
