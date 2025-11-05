import { api } from "../api";
import type { StreamingChunk } from "../classes/Action";
import { Initializer } from "../classes/Initializer";
import pkg from "../package.json";

const namespace = "pubsub";
const redisPubSubChannel = `${pkg.name}:pubsub`;
const redisStreamingChannel = `${pkg.name}:streaming`;

// TODO: Presence (connections in room), including join/leave
// TODO: Auth (key/values) to check access

export type PubSubMessage = {
  channel: string;
  message: string;
  sender: string;
};

export type StreamingPubSubMessage = {
  messageId: string | number;
  chunk: StreamingChunk;
};

export type ClientSubscribeMessage = {
  messageType: "subscribe";
  messageId: string | number;
  channel: string;
};

export type ClientUnsubscribeMessage = {
  messageType: "unsubscribe";
  messageId: string | number;
  channel: string;
};

declare module "../classes/API" {
  export interface API {
    [namespace]: Awaited<ReturnType<PubSub["initialize"]>>;
  }
}

export class PubSub extends Initializer {
  constructor() {
    super(namespace);
    this.startPriority = 150;
    this.stopPriority = 950;
  }

  async initialize() {
    async function broadcast(
      channel: string,
      message: any,
      sender = "unknown-sender",
    ) {
      const payload: PubSubMessage = { channel, message, sender };
      return api.redis.redis.publish(
        redisPubSubChannel,
        JSON.stringify(payload),
      );
    }

    async function broadcastStreamingChunk(chunk: StreamingChunk) {
      const payload: StreamingPubSubMessage = {
        messageId: chunk.messageId,
        chunk,
      };
      return api.redis.redis.publish(
        redisStreamingChannel,
        JSON.stringify(payload),
      );
    }

    return { broadcast, broadcastStreamingChunk };
  }

  async start() {
    if (api.redis.subscription) {
      api.redis.subscription.subscribe(redisPubSubChannel);
      api.redis.subscription.subscribe(redisStreamingChannel);
      api.redis.subscription.on("message", this.handleMessage.bind(this));
    }
  }

  async stop() {
    if (api.redis.subscription) {
      api.redis.subscription.unsubscribe(redisPubSubChannel);
      api.redis.subscription.unsubscribe(redisStreamingChannel);
    }
  }

  async handleMessage(pubSubChannel: string, incomingMessage: string | Buffer) {
    const message = incomingMessage.toString();
    
    if (pubSubChannel === redisStreamingChannel) {
      // Handle streaming messages
      try {
        const payload = JSON.parse(message) as StreamingPubSubMessage;
        const { messageId, chunk } = payload;
        
        // Find all connections that are waiting for this messageId
        for (const connection of api.connections.connections) {
          if (connection.streamingMessageIds?.has(messageId)) {
            // Connection is waiting for this streaming message
            if (connection.onStreamingChunkReceived) {
              connection.onStreamingChunkReceived(chunk);
            }
          }
        }
      } catch (error) {
        // Invalid streaming message format, ignore
      }
    } else if (pubSubChannel === redisPubSubChannel) {
      // Handle regular pub/sub messages
      const payload = JSON.parse(message) as PubSubMessage;
      for (const connection of api.connections.connections) {
        if (connection.subscriptions.has(payload.channel)) {
          connection.onBroadcastMessageReceived(payload);
        }
      }
    }
  }
}
