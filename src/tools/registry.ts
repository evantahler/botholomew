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
// Search tools
import { searchGrepTool } from "./search/grep.ts";
import { searchSemanticTool } from "./search/semantic.ts";
// Task tools
import { completeTaskTool } from "./task/complete.ts";
import { createTaskTool } from "./task/create.ts";
import { failTaskTool } from "./task/fail.ts";
import { waitTaskTool } from "./task/wait.ts";
import { registerTools } from "./tool.ts";

export function registerAllTools(): void {
  registerTools([
    // Task
    completeTaskTool,
    failTaskTool,
    waitTaskTool,
    createTaskTool,

    // Directory
    dirCreateTool,
    dirListTool,
    dirTreeTool,
    dirSizeTool,

    // File
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    fileDeleteTool,
    fileCopyTool,
    fileMoveTool,
    fileInfoTool,
    fileExistsTool,
    fileCountLinesTool,

    // Search
    searchGrepTool,
    searchSemanticTool,
  ]);
}
