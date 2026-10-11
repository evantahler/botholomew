import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { API_URL } from "../utils/client";
import { useAuth } from "./AuthContext";

/** The first reconnect delay; it doubles up to {@link MAX_BACKOFF_MS}. */
const BASE_BACKOFF_MS = 1_000;

/** The ceiling on reconnect backoff, so a long outage settles into a slow retry. */
const MAX_BACKOFF_MS = 30_000;

/** A handler for one channel's parsed inner payload. */
export type LiveChannelHandler = (payload: unknown) => void;

/**
 * Ref-counted channel membership that defers the last unsubscribe until after
 * the current turn.
 *
 * React StrictMode (and any remount in the same turn) runs subscribe, cleanup,
 * subscribe. Sending `unsubscribe` in that cleanup is what produced a
 * subscribe → unsubscribe → subscribe burst Keryx can apply out of order, after
 * which the acknowledgements still say `subscribed` and no broadcast ever
 * arrives. Keeping an empty handler set until the next microtask lets the
 * remount reuse the existing subscription. A real unmount still leaves once
 * the turn ends with nobody holding the channel.
 * @param send - Deliver a subscribe or unsubscribe when the server must change.
 * @returns `subscribe`, `activeChannels`, and `dispatch`.
 */
export function createChannelRegistry(
  send: (messageType: "subscribe" | "unsubscribe", channel: string) => void,
): {
  subscribe: (channel: string, handler: LiveChannelHandler) => () => void;
  activeChannels: () => string[];
  dispatch: (channel: string, payload: unknown) => void;
} {
  const handlers = new Map<string, Set<LiveChannelHandler>>();

  /**
   * Retain `channel` for `handler`. The last release in a turn is deferred.
   * @param channel - The channel name.
   * @param handler - Called for each broadcast on this channel.
   * @returns Drop this handler; the server leave waits until the turn ends.
   */
  function subscribe(channel: string, handler: LiveChannelHandler): () => void {
    let set = handlers.get(channel);
    const created = set === undefined;
    if (!set) {
      set = new Set();
      handlers.set(channel, set);
    }
    set.add(handler);
    if (created) send("subscribe", channel);

    return () => {
      const current = handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size > 0) return;
      queueMicrotask(() => {
        const remaining = handlers.get(channel);
        if (!remaining || remaining.size > 0) return;
        handlers.delete(channel);
        send("unsubscribe", channel);
      });
    };
  }

  /**
   * Channels that currently have at least one handler.
   *
   * Empty sets waiting on the deferred leave are omitted so a reconnect does
   * not resubscribe a channel that is about to drop.
   * @returns Channel names.
   */
  function activeChannels(): string[] {
    return [...handlers.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([channel]) => channel);
  }

  /**
   * Call every handler retained on `channel`.
   * @param channel - The channel the frame named.
   * @param payload - The parsed inner payload.
   */
  function dispatch(channel: string, payload: unknown): void {
    const set = handlers.get(channel);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  return { subscribe, activeChannels, dispatch };
}

/** Everything a subscriber needs from the shared socket. */
export interface LiveSocketState {
  /** Whether the live socket is currently connected. */
  connected: boolean;
  /**
   * Subscribe to a channel. The unsubscribe function also drops the server
   * subscription when this was the last handler.
   */
  subscribe: (channel: string, handler: LiveChannelHandler) => () => void;
}

const LiveSocketContext = createContext<LiveSocketState | null>(null);

/**
 * The WebSocket URL for the backend, derived from the same origin `apiFetch`
 * uses.
 *
 * Keryx serves the socket on the same `Bun.serve` port as HTTP, so there is no
 * second origin to configure — which is also why the deployed blueprint needs
 * nothing new for this.
 * @returns The `ws://` or `wss://` URL.
 */
export function socketUrl(): string {
  return API_URL.replace(/^http/, "ws");
}

/**
 * Pull the channel and inner payload out of a raw socket frame.
 *
 * Keryx wraps a broadcast as `{ message: { channel, message } }` where the inner
 * `message` is whatever the publisher serialized. Everything else on the socket
 * — subscribe confirmations, presence joins, action replies — is not a
 * broadcast and is dropped without ceremony.
 *
 * **Double-encoded, and that is the thing worth pinning.** Publishers serialize
 * our object to a string, and Keryx's web server then wraps the whole PubSub
 * message and serializes that. A reader that unwrapped one layer would get a
 * string where it expected an object and drop every signal silently — which
 * looks exactly like a socket that is not connected.
 * @param raw - The frame's `data`.
 * @returns The channel and parsed payload, or `null`.
 */
export function parseSocketEnvelope(
  raw: unknown,
): { channel: string; payload: unknown } | null {
  if (typeof raw !== "string") return null;

  try {
    const frame = JSON.parse(raw) as {
      message?: { channel?: unknown; message?: unknown };
    };
    const channel = frame.message?.channel;
    const inner = frame.message?.message;
    if (typeof channel !== "string" || typeof inner !== "string") return null;
    return { channel, payload: JSON.parse(inner) };
  } catch {
    return null;
  }
}

/**
 * Whether an event from `source` belongs to the socket the provider currently
 * holds.
 *
 * StrictMode remounts and a `user` identity change open a second socket while
 * the first is still closing. A `close` from the first must not null the
 * second, or {@link LiveSocketState.subscribe} stops sending and there is no
 * poll to recover.
 * @param current - The socket the provider currently holds.
 * @param source - The socket that fired the event.
 * @returns Whether `source` is the live socket.
 */
export function isLiveSocket(
  current: WebSocket | null,
  source: WebSocket,
): boolean {
  return current === source;
}

/**
 * One reconnecting WebSocket for every live channel the signed-in UI needs.
 *
 * **The socket is an accelerant, not the delivery mechanism.** Every page
 * hydrates over HTTP, and a reconnect re-reads. Nothing here depends on a
 * socket having been open the whole time, which is what makes it safe for the
 * socket to be best-effort — a proxy idle-timeout is the normal failure mode.
 *
 * One connection, many `subscribe` messages: Keryx multiplexes channels on a
 * single upgrade. A second socket per page would double the reconnect storms.
 * A page that holds no channel costs one idle connection and nothing else.
 * @param props.children - The subtree that consumes {@link useLiveSocket}.
 * @returns The provider element.
 */
export function LiveSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(BASE_BACKOFF_MS);
  const registry = useRef(
    createChannelRegistry((messageType, channel) => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify({ messageType, channel }));
      }
    }),
  );

  const subscribe = useCallback(
    (channel: string, handler: LiveChannelHandler): (() => void) =>
      registry.current.subscribe(channel, handler),
    [],
  );

  useEffect(() => {
    if (!user) {
      const outgoing = socket.current;
      outgoing?.close();
      if (outgoing && isLiveSocket(socket.current, outgoing)) {
        socket.current = null;
        setConnected(false);
      }
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;

    /** Open a socket and resubscribe every channel that still has a handler. */
    function connect() {
      if (closed) return;

      let next: WebSocket;
      try {
        next = new WebSocket(socketUrl());
      } catch {
        scheduleRetry();
        return;
      }
      ws = next;
      socket.current = next;

      next.addEventListener("open", () => {
        if (closed || !isLiveSocket(socket.current, next)) return;
        backoff.current = BASE_BACKOFF_MS;
        setConnected(true);
        for (const channel of registry.current.activeChannels()) {
          next.send(JSON.stringify({ messageType: "subscribe", channel }));
        }
      });

      next.addEventListener("message", (event) => {
        if (!isLiveSocket(socket.current, next)) return;
        const envelope = parseSocketEnvelope(event.data);
        if (!envelope) return;
        registry.current.dispatch(envelope.channel, envelope.payload);
      });

      next.addEventListener("close", () => {
        if (!isLiveSocket(socket.current, next)) return;
        socket.current = null;
        setConnected(false);
        scheduleRetry();
      });

      next.addEventListener("error", () => {
        if (!isLiveSocket(socket.current, next)) return;
        setConnected(false);
      });
    }

    /** Reconnect after an exponentially growing, capped delay. */
    function scheduleRetry() {
      if (closed) return;
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(connect, backoff.current);
      backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
    }

    connect();

    return () => {
      closed = true;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      const outgoing = ws;
      outgoing?.close();
      if (outgoing && isLiveSocket(socket.current, outgoing)) {
        socket.current = null;
        setConnected(false);
      }
    };
  }, [user]);

  const value = useMemo<LiveSocketState>(
    () => ({ connected, subscribe }),
    [connected, subscribe],
  );

  return (
    <LiveSocketContext.Provider value={value}>
      {children}
    </LiveSocketContext.Provider>
  );
}

/**
 * Access the shared live socket.
 * @returns The socket state.
 * @throws {Error} If called outside a {@link LiveSocketProvider}.
 */
export function useLiveSocket(): LiveSocketState {
  const ctx = useContext(LiveSocketContext);
  if (!ctx) {
    throw new Error("useLiveSocket must be used within a LiveSocketProvider");
  }
  return ctx;
}

/**
 * Subscribe to one channel for the life of the calling component.
 *
 * The handler is stored in a ref so a new callback identity cannot
 * unsubscribe and resubscribe on every render — which would miss frames
 * during the gap and look like a socket that is not connected.
 * @param channel - The channel name, or `null` to hold no subscription.
 * @param onMessage - Called with the parsed inner payload of each broadcast.
 */
export function useLiveChannel(
  channel: string | null,
  onMessage: LiveChannelHandler,
): void {
  const { subscribe } = useLiveSocket();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (payload) => handlerRef.current(payload));
  }, [channel, subscribe]);
}

/**
 * Re-read after a reconnect, including the first successful open.
 *
 * **This is the safety net in place of a timer.** A socket that dies silently
 * is the normal failure mode; the next open is when we know the channel is live
 * again, so that is when we hydrate. A `setInterval` poll is the request storm
 * this context exists to prevent.
 * @param onReconnect - Called when `connected` becomes true.
 */
export function useLiveReconnect(onReconnect: () => void): void {
  const { connected } = useLiveSocket();
  const handlerRef = useRef(onReconnect);
  handlerRef.current = onReconnect;
  const wasConnected = useRef(false);

  useEffect(() => {
    if (connected && !wasConnected.current) {
      handlerRef.current();
    }
    wasConnected.current = connected;
  }, [connected]);
}
