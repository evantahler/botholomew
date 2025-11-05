import { getWebSocketUrl } from "./config";
import type { StreamingChunk } from "../../backend/classes/Action";

export type WebSocketMessageType = "action" | "subscribe" | "unsubscribe";

export type WebSocketActionMessage = {
  messageType: "action";
  messageId: string | number;
  action: string;
  params: Record<string, any>;
};

export type WebSocketMessage = WebSocketActionMessage;

export type StreamingMessageHandler = (chunk: StreamingChunk) => void;
export type ErrorHandler = (error: Error) => void;
export type ConnectionHandler = () => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private messageHandlers = new Map<string | number, StreamingMessageHandler>();
  private errorHandler: ErrorHandler | null = null;
  private onOpenHandler: ConnectionHandler | null = null;
  private onCloseHandler: ConnectionHandler | null = null;
  private isConnecting = false;

  constructor() {
    this.url = getWebSocketUrl();
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.isConnecting) {
      return new Promise((resolve, reject) => {
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
          } else if (!this.isConnecting) {
            clearInterval(checkConnection);
            reject(new Error("Connection failed"));
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          if (this.onOpenHandler) {
            this.onOpenHandler();
          }
          resolve();
        };

        this.ws.onerror = (error) => {
          this.isConnecting = false;
          if (this.errorHandler) {
            this.errorHandler(new Error("WebSocket error"));
          }
          reject(error);
        };

        this.ws.onclose = () => {
          this.isConnecting = false;
          if (this.onCloseHandler) {
            this.onCloseHandler();
          }
          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
              this.connect().catch(() => {
                // Reconnection failed, will retry
              });
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Check if it's a streaming chunk
            if (data.type && data.type.startsWith("stream:")) {
              const chunk = data as StreamingChunk;
              const handler = this.messageHandlers.get(chunk.messageId);
              if (handler) {
                handler(chunk);
              }
            } else if (data.messageId && this.messageHandlers.has(data.messageId)) {
              // Handle non-streaming responses
              const handler = this.messageHandlers.get(data.messageId)!;
              handler({
                messageId: data.messageId,
                type: "stream:done",
                data: data.response || data.error,
              });
            }
          } catch (error) {
            if (this.errorHandler) {
              this.errorHandler(
                error instanceof Error ? error : new Error("Failed to parse message"),
              );
            }
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
  }

  send(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  onStreamingMessage(
    messageId: string | number,
    handler: StreamingMessageHandler,
  ): void {
    this.messageHandlers.set(messageId, handler);
  }

  removeStreamingHandler(messageId: string | number): void {
    this.messageHandlers.delete(messageId);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  onOpen(handler: ConnectionHandler): void {
    this.onOpenHandler = handler;
  }

  onClose(handler: ConnectionHandler): void {
    this.onCloseHandler = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsClientInstance: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient();
  }
  return wsClientInstance;
}
