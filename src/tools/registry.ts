// Capabilities tools
import { capabilitiesRefreshTool } from "./capabilities/refresh.ts";
// Context tools
import { contextListDrivesTool } from "./context/list-drives.ts";
import { pipeToContextTool } from "./context/pipe.ts";
import { readLargeResultTool } from "./context/read-large-result.ts";
import { contextRefreshTool } from "./context/refresh.ts";
import { contextSearchTool } from "./context/search.ts";
import { updateBeliefsTool } from "./context/update-beliefs.ts";
import { updateGoalsTool } from "./context/update-goals.ts";
// Context — directory operations
import { contextCreateDirTool } from "./dir/create.ts";
import { contextDirSizeTool } from "./dir/size.ts";
import { contextTreeTool } from "./dir/tree.ts";
// Context — file operations
import { contextCopyTool } from "./file/copy.ts";
import { contextCountLinesTool } from "./file/count-lines.ts";
import { contextDeleteTool } from "./file/delete.ts";
import { contextEditTool } from "./file/edit.ts";
import { contextExistsTool } from "./file/exists.ts";
import { contextInfoTool } from "./file/info.ts";
import { contextMoveTool } from "./file/move.ts";
import { contextReadTool } from "./file/read.ts";
import { contextWriteTool } from "./file/write.ts";
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
// Skill tools
import { skillDeleteTool } from "./skill/delete.ts";
import { skillEditTool } from "./skill/edit.ts";
import { skillListTool } from "./skill/list.ts";
import { skillReadTool } from "./skill/read.ts";
import { skillSearchTool } from "./skill/search.ts";
import { skillWriteTool } from "./skill/write.ts";
// Task tools
import { completeTaskTool } from "./task/complete.ts";
import { createTaskTool } from "./task/create.ts";
import { deleteTaskTool } from "./task/delete.ts";
import { failTaskTool } from "./task/fail.ts";
import { listTasksTool } from "./task/list.ts";
import { updateTaskTool } from "./task/update.ts";
import { viewTaskTool } from "./task/view.ts";
import { waitTaskTool } from "./task/wait.ts";
// Thread tools
import { listThreadsTool } from "./thread/list.ts";
import { viewThreadTool } from "./thread/view.ts";
import { registerTool } from "./tool.ts";
// Worker tools
import { spawnWorkerTool } from "./worker/spawn.ts";

export function registerAllTools(): void {
  // Task
  registerTool(completeTaskTool);
  registerTool(failTaskTool);
  registerTool(waitTaskTool);
  registerTool(createTaskTool);
  registerTool(updateTaskTool);
  registerTool(deleteTaskTool);
  registerTool(listTasksTool);
  registerTool(viewTaskTool);

  // Context
  registerTool(contextListDrivesTool);
  registerTool(contextCreateDirTool);
  registerTool(contextTreeTool);
  registerTool(contextDirSizeTool);
  registerTool(contextReadTool);
  registerTool(contextWriteTool);
  registerTool(contextEditTool);
  registerTool(contextDeleteTool);
  registerTool(contextCopyTool);
  registerTool(contextMoveTool);
  registerTool(contextInfoTool);
  registerTool(contextExistsTool);
  registerTool(contextCountLinesTool);
  registerTool(contextSearchTool);
  registerTool(contextRefreshTool);
  registerTool(updateBeliefsTool);
  registerTool(updateGoalsTool);
  registerTool(readLargeResultTool);
  registerTool(pipeToContextTool);

  // Capabilities
  registerTool(capabilitiesRefreshTool);

  // Schedule
  registerTool(createScheduleTool);
  registerTool(listSchedulesTool);

  // Search
  registerTool(searchGrepTool);
  registerTool(searchSemanticTool);

  // Skill
  registerTool(skillListTool);
  registerTool(skillReadTool);
  registerTool(skillWriteTool);
  registerTool(skillEditTool);
  registerTool(skillSearchTool);
  registerTool(skillDeleteTool);

  // Thread
  registerTool(listThreadsTool);
  registerTool(viewThreadTool);

  // MCP
  registerTool(mcpListToolsTool);
  registerTool(mcpSearchTool);
  registerTool(mcpInfoTool);
  registerTool(mcpExecTool);

  // Worker
  registerTool(spawnWorkerTool);
}
