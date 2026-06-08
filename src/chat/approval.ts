/**
 * Bridge between the mcpx approval callback (which runs deep inside a chat turn,
 * awaiting a boolean) and the Ink TUI (which renders a prompt and resolves it on
 * a keypress). The mcpx client is constructed before the TUI mounts, so the
 * callback can't reference React state directly — it talks to this bridge, and
 * a TUI hook subscribes to drive the prompt.
 *
 * Gated tool calls within a single turn run in parallel (`Promise.all`), so the
 * bridge holds a FIFO queue and surfaces one request at a time.
 */
export interface ChatApprovalRequest {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

interface PendingApproval {
  req: ChatApprovalRequest;
  resolve: (approved: boolean) => void;
}

export interface ChatApprovalBridge {
  /** Called by the mcpx callback; resolves once the user decides. */
  request(req: ChatApprovalRequest): Promise<boolean>;
  /** The request currently awaiting a decision (head of the queue), or null. */
  current(): ChatApprovalRequest | null;
  /** Resolve the head request with the user's decision. */
  resolve(approved: boolean): void;
  /** Subscribe to queue changes (UI re-render). Returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}

export function createApprovalBridge(): ChatApprovalBridge {
  const queue: PendingApproval[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  return {
    request(req) {
      return new Promise<boolean>((resolve) => {
        queue.push({ req, resolve });
        notify();
      });
    },
    current() {
      return queue[0]?.req ?? null;
    },
    resolve(approved) {
      const head = queue.shift();
      head?.resolve(approved);
      notify();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
