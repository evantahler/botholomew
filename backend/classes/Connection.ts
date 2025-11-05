import colors from "colors";
import { randomUUID } from "crypto";
import { api, logger } from "../api";
import { config } from "../config";
import type { PubSubMessage } from "../initializers/pubsub";
import type { SessionData } from "../initializers/session";
import "../util/zodMixins";
import type { Action, ActionParams, StreamingChunk } from "./Action";
import { ErrorType, TypedError } from "./TypedError";

export class Connection<T extends Record<string, any> = Record<string, any>> {
  type: string;
  identifier: string;
  id: string;
  session?: SessionData<T>;
  subscriptions: Set<string>;
  sessionLoaded: boolean;
  rawConnection?: any;
  sendStreamingChunkCallback?: (chunk: StreamingChunk) => Promise<void>;

  constructor(
    type: string,
    identifier: string,
    id = randomUUID() as string,
    rawConnection: any = undefined,
  ) {
    this.type = type;
    this.identifier = identifier;
    this.id = id;
    this.sessionLoaded = false;
    this.subscriptions = new Set();
    this.rawConnection = rawConnection;
    this.sendStreamingChunkCallback = undefined;

    api.connections.connections.push(this);
  }

  /**
   * Sends a streaming chunk to the client.
   * Only works if connection is in streaming mode (WebSocket).
   */
  async sendStreamingChunk(chunk: StreamingChunk): Promise<void> {
    if (!this.sendStreamingChunkCallback) {
      throw new TypedError({
        message: "Connection does not support streaming",
        type: ErrorType.CONNECTION_TYPE_NOT_FOUND,
      });
    }
    await this.sendStreamingChunkCallback(chunk);
  }

  /**
   * Runs an action in streaming mode.
   * Only works for actions that support streaming and WebSocket connections.
   */
  async actStreaming(
    actionName: string | undefined,
    params: FormData,
    method: Request["method"],
    url: string,
    sendChunk: (chunk: StreamingChunk) => Promise<void>,
  ): Promise<void> {
    const reqStartTime = new Date().getTime();
    let loggerResponsePrefix: "OK" | "ERROR" = "OK";
    let error: TypedError | undefined;

    // Store callback for use in action
    this.sendStreamingChunkCallback = sendChunk;

    let action: Action | undefined;
    try {
      action = this.findAction(actionName);
      if (!action) {
        throw new TypedError({
          message: `Action not found${actionName ? `: ${actionName}` : ""}`,
          type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
        });
      }

      if (!action.streaming) {
        throw new TypedError({
          message: `Action ${actionName} does not support streaming`,
          type: ErrorType.CONNECTION_ACTION_RUN,
        });
      }

      if (!action.runStreaming) {
        throw new TypedError({
          message: `Action ${actionName} declared streaming support but does not implement runStreaming()`,
          type: ErrorType.CONNECTION_ACTION_RUN,
        });
      }

      // Get messageId from raw params first (before formatting)
      let messageId = "unknown";
      const rawParamsObj: Record<string, any> = {};
      params.forEach((value, key) => {
        rawParamsObj[key] = value;
        if (key === "messageId") {
          messageId = String(value);
        }
      });

      // load the session once, if it hasn't been loaded yet
      if (!this.sessionLoaded) await this.loadSession();

      let formattedParams = await this.formatParams(params, action);

      for (const middleware of action.middleware ?? []) {
        if (middleware.runBefore) {
          const middlewareResponse = await middleware.runBefore(
            formattedParams,
            this,
          );
          if (middlewareResponse && middlewareResponse?.updatedParams)
            formattedParams = middlewareResponse.updatedParams;
        }
      }

      // Get messageId from formatted params if not found in raw params
      if (messageId === "unknown" && (formattedParams as any).messageId) {
        messageId = String((formattedParams as any).messageId);
      }

      // Send start message
      await sendChunk({
        messageId,
        type: "stream:start",
        data: {},
      });

      // Run streaming action
      await action.runStreaming(formattedParams, this, sendChunk);

      // Send done message (action should have sent final data in chunks)
      await sendChunk({
        messageId,
        type: "stream:done",
        data: {},
      });
    } catch (e) {
      loggerResponsePrefix = "ERROR";
      error =
        e instanceof TypedError
          ? e
          : new TypedError({
              message: `${e}`,
              type: ErrorType.CONNECTION_ACTION_RUN,
              originalError: e,
            });

      // Send error message
      const messageId = (action ? await this.formatParams(params, action) : {}) as any;
      try {
        await sendChunk({
          messageId: messageId.messageId || "unknown",
          type: "stream:error",
          error: {
            message: error.message,
            type: error.type,
            timestamp: new Date().getTime(),
          },
        });
      } catch (sendError) {
        // If we can't send error, log it
        logger.error(`Failed to send streaming error: ${sendError}`);
      }
    } finally {
      // Clear callback
      this.sendStreamingChunkCallback = undefined;
    }

    // Log the action execution
    const sanitizedParams = sanitizeParams(params, action);
    const loggingParams = config.logger.colorize
      ? colors.gray(JSON.stringify(sanitizedParams))
      : JSON.stringify(sanitizedParams);

    const statusMessage = `[ACTION:${loggerResponsePrefix}]`;
    const messagePrefix = config.logger.colorize
      ? loggerResponsePrefix === "OK"
        ? colors.bgBlue(statusMessage)
        : colors.bgMagenta(statusMessage)
      : statusMessage;

    const duration = new Date().getTime() - reqStartTime;

    const errorStack =
      error && error.stack
        ? config.logger.colorize
          ? "\r\n" + colors.gray(error.stack)
          : "\r\n" + error.stack
        : "";

    logger.info(
      `${messagePrefix} ${actionName} (${duration}ms) [STREAMING] ${method.length > 0 ? `[${method}]` : ""} ${this.identifier}${url.length > 0 ? `(${url})` : ""} ${error ? error : ""} ${loggingParams} ${errorStack}`,
    );
  }

  /**
   * Runs an action for this connection, given FormData params.
   *  Throws errors.
   */
  async act(
    actionName: string | undefined,
    params: FormData, // note: params are not constant for all connections - some are long-lived, like websockets
    method: Request["method"] = "",
    url: string = "",
  ): Promise<{ response: Object; error?: TypedError }> {
    const reqStartTime = new Date().getTime();
    let loggerResponsePrefix: "OK" | "ERROR" = "OK";
    let response: Object = {};
    let error: TypedError | undefined;

    let action: Action | undefined;
    try {
      action = this.findAction(actionName);
      if (!action) {
        throw new TypedError({
          message: `Action not found${actionName ? `: ${actionName}` : ""}`,
          type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
        });
      }

      // load the session once, if it hasn't been loaded yet
      if (!this.sessionLoaded) await this.loadSession();

      let formattedParams = await this.formatParams(params, action);

      for (const middleware of action.middleware ?? []) {
        if (middleware.runBefore) {
          const middlewareResponse = await middleware.runBefore(
            formattedParams,
            this,
          );
          if (middlewareResponse && middlewareResponse?.updatedParams)
            formattedParams = middlewareResponse.updatedParams;
        }
      }

      response = await action.run(formattedParams, this);

      for (const middleware of action.middleware ?? []) {
        if (middleware.runAfter) {
          const middlewareResponse = await middleware.runAfter(
            formattedParams,
            this,
          );
          if (middlewareResponse && middlewareResponse?.updatedResponse)
            response = middlewareResponse.updatedResponse;
        }
      }
    } catch (e) {
      loggerResponsePrefix = "ERROR";
      error =
        e instanceof TypedError
          ? e
          : new TypedError({
              message: `${e}`,
              type: ErrorType.CONNECTION_ACTION_RUN,
              originalError: e,
            });
    }

    // Note: we want the params object to remain on the same line as the message, so we stringify
    const sanitizedParams = sanitizeParams(params, action);
    const loggingParams = config.logger.colorize
      ? colors.gray(JSON.stringify(sanitizedParams))
      : JSON.stringify(sanitizedParams);

    const statusMessage = `[ACTION:${loggerResponsePrefix}]`;
    const messagePrefix = config.logger.colorize
      ? loggerResponsePrefix === "OK"
        ? colors.bgBlue(statusMessage)
        : colors.bgMagenta(statusMessage)
      : statusMessage;

    const duration = new Date().getTime() - reqStartTime;

    const errorStack =
      error && error.stack
        ? config.logger.colorize
          ? "\r\n" + colors.gray(error.stack)
          : "\r\n" + error.stack
        : "";

    logger.info(
      `${messagePrefix} ${actionName} (${duration}ms) ${method.length > 0 ? `[${method}]` : ""} ${this.identifier}${url.length > 0 ? `(${url})` : ""} ${error ? error : ""} ${loggingParams} ${errorStack}`,
    );

    return { response, error };
  }

  async updateSession(data: Partial<T>) {
    await this.loadSession();

    if (!this.session) {
      throw new TypedError({
        message: "Session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }

    return api.session.update(this.session, data);
  }

  subscribe(channel: string) {
    this.subscriptions.add(channel);
  }

  unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
  }

  async broadcast(channel: string, message: string) {
    if (!this.subscriptions.has(channel)) {
      throw new TypedError({
        message: "not subscribed to this channel",
        type: ErrorType.CONNECTION_NOT_SUBSCRIBED,
      });
    }

    return api.pubsub.broadcast(channel, message, this.id);
  }

  onBroadcastMessageReceived(payload: PubSubMessage) {
    throw new Error(
      "unimplemented - this should be overwritten by connections that support it",
    );
  }

  destroy() {
    return api.connections.destroy(this.type, this.identifier, this.id);
  }

  private async loadSession() {
    if (this.session) return;

    const session = await api.session.load(this);
    if (session) {
      this.session = session as SessionData<T>;
    } else {
      this.session = await api.session.create(this);
    }
  }

  private findAction(actionName: string | undefined) {
    return api.actions.actions.find((a: Action) => a.name === actionName);
  }

  private async formatParams(params: FormData, action: Action) {
    if (!action.inputs) return {} as ActionParams<Action>;

    // Convert FormData to a plain object for processing
    const rawParams: Record<string, any> = {};
    params.forEach((value, key) => {
      if (rawParams[key] !== undefined) {
        // If the key already exists, convert to array
        if (Array.isArray(rawParams[key])) {
          rawParams[key].push(value);
        } else {
          rawParams[key] = [rawParams[key], value];
        }
      } else {
        rawParams[key] = value;
      }
    });

    // Handle zod schema inputs
    if (
      typeof action.inputs === "object" &&
      action.inputs &&
      "safeParse" in action.inputs
    ) {
      // This is a zod schema
      try {
        const result = (action.inputs as any).safeParse(rawParams);
        if (!result.success) {
          // Get the first validation error
          const firstError = result.error.errors[0];
          const key = firstError.path[0];
          const value = rawParams[key];
          let message = firstError.message;
          if (message === "Required") {
            message = `Missing required param: ${key}`;
          }
          throw new TypedError({
            message,
            type: ErrorType.CONNECTION_ACTION_PARAM_REQUIRED,
            key,
            value,
          });
        }
        return result.data as ActionParams<Action>;
      } catch (e) {
        if (e instanceof TypedError) {
          throw e;
        }
        throw new TypedError({
          message: `Error validating params: ${e}`,
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
          originalError: e,
        });
      }
    }

    // If we get here, inputs is not a zod schema, return empty object
    return {} as ActionParams<Action>;
  }
}

const REDACTED = "[[secret]]" as const;

const sanitizeParams = (params: FormData, action: Action | undefined) => {
  const sanitizedParams: Record<string, any> = {};

  // Get secret fields from the action's zod schema if it exists
  const secretFields = new Set<string>();
  if (action?.inputs && typeof action.inputs === "object") {
    const zodSchema = action.inputs as any;
    if (zodSchema._def?.typeName === "ZodObject" && zodSchema.shape) {
      for (const [fieldName, fieldSchema] of Object.entries(zodSchema.shape)) {
        if ((fieldSchema as any)._def?.isSecret) {
          secretFields.add(fieldName);
        }
      }
    }
  }

  params.forEach((v, k) => {
    if (secretFields.has(k)) {
      sanitizedParams[k] = REDACTED;
    } else {
      sanitizedParams[k] = v;
    }
  });

  return sanitizedParams;
};
