import type { HostFunctions } from "run";
import type { ToolContext } from "../../tool.ts";
import { createFilesHost, type FilesHostOptions } from "./files.ts";
import { createMcpHost } from "./mcp.ts";

export function buildHostFunctions(
  ctx: ToolContext,
  opts: FilesHostOptions,
): HostFunctions {
  return {
    files: createFilesHost(ctx, opts),
    mcp: createMcpHost(ctx),
  } as unknown as HostFunctions;
}
