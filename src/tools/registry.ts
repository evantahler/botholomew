// Capabilities tools
import { capabilitiesRefreshTool } from "./capabilities/refresh.ts";
// MCP tools
import { mcpExecTool } from "./mcp/exec.ts";
import { mcpInfoTool } from "./mcp/info.ts";
import { mcpListToolsTool } from "./mcp/list-tools.ts";
import { mcpSearchTool } from "./mcp/search.ts";
// Membot tools (knowledge store)
import { registerMembotTools } from "./membot/index.ts";
// Prompt tools
import { promptCreateTool } from "./prompt/create.ts";
import { promptDeleteTool } from "./prompt/delete.ts";
import { promptEditTool } from "./prompt/edit.ts";
import { promptListTool } from "./prompt/list.ts";
import { promptReadTool } from "./prompt/read.ts";
// Schedule tools
import { createScheduleTool } from "./schedule/create.ts";
import { scheduleEditTool } from "./schedule/edit.ts";
import { listSchedulesTool } from "./schedule/list.ts";
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
import { taskEditTool } from "./task/edit.ts";
import { failTaskTool } from "./task/fail.ts";
import { listTasksTool } from "./task/list.ts";
import { updateTaskTool } from "./task/update.ts";
import { viewTaskTool } from "./task/view.ts";
import { waitTaskTool } from "./task/wait.ts";
// Thread tools
import { listThreadsTool } from "./thread/list.ts";
import { searchThreadsTool } from "./thread/search.ts";
import { viewThreadTool } from "./thread/view.ts";
import { registerTool } from "./tool.ts";
// Util tools
import { sleepTool } from "./util/sleep.ts";
// Worker tools
import { spawnWorkerTool } from "./worker/spawn.ts";

export function registerAllTools(): void {
  // Task
  registerTool(completeTaskTool);
  registerTool(failTaskTool);
  registerTool(waitTaskTool);
  registerTool(createTaskTool);
  registerTool(updateTaskTool);
  registerTool(taskEditTool);
  registerTool(deleteTaskTool);
  registerTool(listTasksTool);
  registerTool(viewTaskTool);

  // Knowledge store (membot) — add/read/write/edit/search/versions/refresh etc.
  registerMembotTools();

  // Prompts
  registerTool(promptListTool);
  registerTool(promptReadTool);
  registerTool(promptCreateTool);
  registerTool(promptEditTool);
  registerTool(promptDeleteTool);

  // Capabilities
  registerTool(capabilitiesRefreshTool);

  // Schedule
  registerTool(createScheduleTool);
  registerTool(scheduleEditTool);
  registerTool(listSchedulesTool);

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
  registerTool(searchThreadsTool);

  // MCP
  registerTool(mcpListToolsTool);
  registerTool(mcpSearchTool);
  registerTool(mcpInfoTool);
  registerTool(mcpExecTool);

  // Util
  registerTool(sleepTool);

  // Worker
  registerTool(spawnWorkerTool);
}
