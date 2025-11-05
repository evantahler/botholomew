import { z } from "zod";
import type { Connection } from "./Connection";
import type { TypedError } from "./TypedError";

export enum HTTP_METHOD {
  "GET" = "GET",
  "POST" = "POST",
  "PUT" = "PUT",
  "DELETE" = "DELETE",
  "PATCH" = "PATCH",
  "OPTIONS" = "OPTIONS",
}

export const DEFAULT_QUEUE = "default";

export type StreamingMessageType =
  | "stream:start"
  | "stream:chunk"
  | "stream:done"
  | "stream:error";

export type StreamingChunk = {
  messageId: string | number;
  type: StreamingMessageType;
  data?: any;
  error?: any;
};

export type ActionConstructorInputs = {
  name: string;
  description?: string;
  inputs?: z.ZodType<any>;
  middleware?: ActionMiddleware[];
  web?: {
    route?: RegExp | string;
    method?: HTTP_METHOD;
  };
  task?: {
    frequency?: number;
    queue: string;
  };
  streaming?: boolean;
};

export type ActionMiddlewareResponse = {
  updatedParams?: ActionParams<Action>;
  updatedResponse?: any;
};

export type ActionMiddleware = {
  runBefore?: (
    params: ActionParams<Action>,
    connection: Connection,
  ) => Promise<ActionMiddlewareResponse | void>;
  runAfter?: (
    params: ActionParams<Action>,
    connection: Connection,
  ) => Promise<ActionMiddlewareResponse | void>;
};

export abstract class Action {
  name: string;
  description?: string;
  inputs?: z.ZodType<any>;
  middleware?: ActionMiddleware[];
  web?: {
    route: RegExp | string;
    method: HTTP_METHOD;
  };
  task?: {
    frequency?: number;
    queue: string;
  };
  streaming?: boolean;

  constructor(args: ActionConstructorInputs) {
    this.name = args.name;
    this.description = args.description ?? `An Action: ${this.name}`;
    this.inputs = args.inputs;
    this.middleware = args.middleware ?? [];
    this.web = {
      route: args.web?.route ?? `/${this.name}`,
      method: args.web?.method ?? HTTP_METHOD.GET,
    };
    this.task = {
      frequency: args.task?.frequency,
      queue: args.task?.queue ?? DEFAULT_QUEUE,
    };
    this.streaming = args.streaming ?? false;
  }

  /**
   * The main "do something" method for this action.
   * It can be `async`.
   * Usually the goal of this run method is to return the data that you want to be sent to API consumers.
   * If error is thrown in this method, it will be logged, caught, and returned to the client as `error`
   */
  abstract run(
    params: ActionParams<Action>,
    connection?: Connection,
  ): Promise<any>;

  /**
   * Optional streaming method for actions that support streaming.
   * Called when action is executed in streaming mode.
   * Use onChunk callback to send incremental updates to the client.
   */
  runStreaming?(
    params: ActionParams<Action>,
    connection: Connection,
    onChunk: (chunk: StreamingChunk) => Promise<void>,
  ): Promise<void>;
}

export type ActionParams<A extends Action> =
  A["inputs"] extends z.ZodType<any>
    ? z.infer<A["inputs"]>
    : Record<string, unknown>;

export type ActionResponse<A extends Action> = Awaited<ReturnType<A["run"]>> &
  Partial<{ error?: TypedError }>;
