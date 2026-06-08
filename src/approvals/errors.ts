/**
 * Thrown by a worker's `onApprovalRequired` callback when a gated mcpx call has
 * no decision yet (a fresh `approvals/<id>.md` was just written, or an existing
 * one is still pending). It propagates out of `McpxClient.exec()` — unlike a
 * `false` return, which mcpx turns into `ToolApprovalDeniedError`. `mcp_exec`
 * catches it, signals the worker loop to park the task as `waiting`, and returns
 * a structured "awaiting approval" result to the agent.
 */
export class ApprovalPendingError extends Error {
  readonly approvalId: string;
  readonly server: string;
  readonly tool: string;
  constructor(approvalId: string, server: string, tool: string) {
    super(
      `Tool "${server}/${tool}" is awaiting human approval (${approvalId}).`,
    );
    this.name = "ApprovalPendingError";
    this.approvalId = approvalId;
    this.server = server;
    this.tool = tool;
  }
}
