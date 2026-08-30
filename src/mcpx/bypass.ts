import { AsyncLocalStorage } from "node:async_hooks";

/**
 * When a host function has already obtained a human resolution (Run resume),
 * wrap the subsequent `mcpxClient.exec` so the client's approval callback
 * returns true without prompting or writing a second approval record.
 */
const store = new AsyncLocalStorage<true>();

export function withMcpApprovalBypass<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn);
}

export function isMcpApprovalBypassed(): boolean {
  return store.getStore() === true;
}
