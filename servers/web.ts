import cookie from "cookie";
import colors from "colors";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "node:url";
import { randomUUID } from "crypto";
import formidable from "formidable";
import { Connection } from "../classes/Connection";
import { ErrorStatusCodes, ErrorType, TypedError } from "../classes/TypedError";
import { Server } from "../classes/Server";
import { config } from "../config";
import { logger, api } from "../api";
import { type HTTP_METHOD, type ActionParams } from "../classes/Action";
import type {
  ClientSubscribeMessage,
  ClientUnsubscribeMessage,
  PubSubMessage,
} from "../initializers/pubsub";

interface WebSocketData {
  ip: string;
  id: string;
  headers: any;
  cookies: any;
}

export class WebServer extends Server<ReturnType<typeof createServer>> {
  private wss: WebSocketServer | null = null;

  constructor() {
    super("web");
  }

  async initialize() {}

  async start() {
    if (config.server.web.enabled !== true) return;

    this.server = createServer(this.handleIncomingConnection.bind(this));

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.server,
      path: "/ws", // You can adjust this path as needed
    });

    this.wss.on("connection", this.handleWebSocketConnectionOpen.bind(this));

    this.server.listen(config.server.web.port, config.server.web.host, () => {
      const startMessage = `started server @ http://${config.server.web.host}:${config.server.web.port}`;
      logger.info(logger.colorize ? colors.bgBlue(startMessage) : startMessage);
    });
  }

  async stop() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
      logger.info(
        `stopped app server @ ${config.server.web.host}:${config.server.web.port}`,
      );
    }
  }

  async handleIncomingConnection(req: IncomingMessage, res: ServerResponse) {
    const ip = req.socket.remoteAddress || "unknown-IP";
    const headers = req.headers;
    const cookies = cookie.parse(req.headers.cookie ?? "");
    const id = cookies[config.session.cookieName] || randomUUID();

    // Check if this is a WebSocket upgrade request
    if (req.headers.upgrade === "websocket") {
      // Let the WebSocket server handle it
      return;
    }

    const parsedUrl = parse(req.url!, true);
    return this.handleWebAction(req, res, parsedUrl, ip, id);
  }

  handleWebSocketConnectionOpen(ws: WebSocket, req: IncomingMessage) {
    const ip = req.socket.remoteAddress || "unknown-IP";
    const headers = req.headers;
    const cookies = cookie.parse(req.headers.cookie ?? "");
    const id = cookies[config.session.cookieName] || randomUUID();

    // Store connection data
    (ws as any).data = { ip, id, headers, cookies } as WebSocketData;

    const connection = new Connection("websocket", ip, id, ws);
    connection.onBroadcastMessageReceived = function (payload: PubSubMessage) {
      ws.send(JSON.stringify({ message: payload }));
    };
    logger.info(
      `New websocket connection from ${connection.identifier} (${connection.id})`,
    );

    ws.on("message", (message) => {
      this.handleWebSocketConnectionMessage(ws, message.toString());
    });

    ws.on("close", () => {
      this.handleWebSocketConnectionClose(ws);
    });
  }

  async handleWebSocketConnectionMessage(
    ws: WebSocket,
    message: string | Buffer,
  ) {
    const wsData = (ws as any).data as WebSocketData;
    const { connection } = api.connections.find(
      "websocket",
      wsData.ip,
      wsData.id,
    );

    if (!connection) {
      throw new TypedError({
        message: "No connection found",
        type: ErrorType.SERVER_INITIALIZATION,
      });
    }

    try {
      const parsedMessage = JSON.parse(message.toString());
      if (parsedMessage["messageType"] === "action") {
        this.handleWebsocketAction(connection, ws, parsedMessage);
      } else if (parsedMessage["messageType"] === "subscribe") {
        this.handleWebsocketSubscribe(connection, ws, parsedMessage);
      } else if (parsedMessage["messageType"] === "unsubscribe") {
        this.handleWebsocketUnsubscribe(connection, ws, parsedMessage);
      } else {
        throw new TypedError({
          message: `messageType either missing or unknown`,
          type: ErrorType.CONNECTION_TYPE_NOT_FOUND,
        });
      }
    } catch (e) {
      ws.send(
        JSON.stringify({
          error: buildErrorPayload(
            new TypedError({
              message: `${e}`,
              type: ErrorType.CONNECTION_ACTION_RUN,
            }),
          ),
        }),
      );
    }
  }

  handleWebSocketConnectionClose(ws: WebSocket) {
    const wsData = (ws as any).data as WebSocketData;
    const { connection } = api.connections.find(
      "websocket",
      wsData.ip,
      wsData.id,
    );
    try {
      connection.destroy();
      logger.info(
        `websocket connection closed from ${connection.identifier} (${connection.id})`,
      );
    } catch (e) {
      logger.error(`Error destroying connection: ${e}`);
    }
  }

  async handleWebsocketAction(
    connection: Connection,
    ws: WebSocket,
    formattedMessage: ActionParams<any>,
  ) {
    const params = new FormData();
    for (const [key, value] of Object.entries(formattedMessage.params)) {
      params.append(key, value as string);
    }

    const { response, error } = await connection.act(
      formattedMessage.action,
      params,
      "WEBSOCKET",
    );

    if (error) {
      ws.send(
        JSON.stringify({
          messageId: formattedMessage.messageId,
          error: { ...buildErrorPayload(error) },
        }),
      );
    } else {
      ws.send(
        JSON.stringify({
          messageId: formattedMessage.messageId,
          response: { ...response },
        }),
      );
    }
  }

  async handleWebsocketSubscribe(
    connection: Connection,
    ws: WebSocket,
    formattedMessage: ClientSubscribeMessage,
  ) {
    connection.subscribe(formattedMessage.channel);
    ws.send(
      JSON.stringify({
        messageId: formattedMessage.messageId,
        subscribed: { channel: formattedMessage.channel },
      }),
    );
  }

  async handleWebsocketUnsubscribe(
    connection: Connection,
    ws: WebSocket,
    formattedMessage: ClientUnsubscribeMessage,
  ) {
    connection.unsubscribe(formattedMessage.channel);
    ws.send(
      JSON.stringify({
        messageId: formattedMessage.messageId,
        unsubscribed: { channel: formattedMessage.channel },
      }),
    );
  }

  async handleWebAction(
    req: IncomingMessage,
    res: ServerResponse,
    url: ReturnType<typeof parse>,
    ip: string,
    id: string,
  ) {
    if (!this.server) {
      throw new TypedError({
        message: "Server server not started",
        type: ErrorType.SERVER_START,
      });
    }

    let errorStatusCode = 500;
    const httpMethod = req.method?.toUpperCase() as HTTP_METHOD;

    const connection = new Connection("web", ip, id);

    // Handle OPTIONS requests.
    // As we don't really know what action the client wants (HTTP Method is always OPTIONS), we just return a 200 response.
    if (httpMethod === "OPTIONS") {
      return buildResponse(connection, {}, res);
    }

    const actionName = await this.determineActionName(url, httpMethod);
    if (!actionName) errorStatusCode = 404;

    // param load order: url params -> body params -> query params
    let params = new FormData();

    // Handle different content types
    if (
      req.method !== "GET" &&
      req.headers["content-type"] === "application/json"
    ) {
      try {
        const bodyContent = await this.parseJsonBody(req);
        for (const [key, value] of Object.entries(bodyContent)) {
          params.set(key, value as any);
        }
      } catch (e) {
        throw new TypedError({
          message: `cannot parse request body: ${e}`,
          type: ErrorType.CONNECTION_ACTION_RUN,
          originalError: e,
        });
      }
    } else if (
      req.method !== "GET" &&
      (req.headers["content-type"]?.includes("multipart/form-data") ||
        req.headers["content-type"]?.includes(
          "application/x-www-form-urlencoded",
        ))
    ) {
      const formData = await this.parseFormData(req);
      for (const [key, value] of formData.entries()) {
        params.append(key, value);
      }
    }

    if (url.query) {
      for (const [key, values] of Object.entries(url.query)) {
        if (values !== undefined) {
          if (Array.isArray(values)) {
            for (const v of values) params.append(key, v);
          } else {
            params.append(key, values);
          }
        }
      }
    }

    const { response, error } = await connection.act(
      actionName,
      params,
      httpMethod,
      req.url,
    );

    connection.destroy();

    if (error && ErrorStatusCodes[error.type]) {
      errorStatusCode = ErrorStatusCodes[error.type];
    }

    return error
      ? buildError(connection, error, res, errorStatusCode)
      : buildResponse(connection, response, res);
  }

  private async parseJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  private async parseFormData(req: IncomingMessage): Promise<FormData> {
    return new Promise((resolve, reject) => {
      const form = formidable({
        keepExtensions: false,
        allowEmptyFiles: false,
        maxFileSize: 0, // No file uploads for now
      });

      form.parse(req, (err, fields, files) => {
        if (err) {
          reject(err);
          return;
        }

        const formData = new FormData();

        // Add fields to FormData
        for (const [key, value] of Object.entries(fields)) {
          if (Array.isArray(value)) {
            // Handle multiple values with the same key
            for (const val of value) {
              if (val !== undefined) {
                formData.append(key, val);
              }
            }
          } else if (value !== undefined) {
            formData.append(key, value);
          }
        }

        resolve(formData);
      });
    });
  }

  async determineActionName(
    url: ReturnType<typeof parse>,
    method: HTTP_METHOD,
  ) {
    const pathToMatch = url.pathname?.replace(
      new RegExp(`${config.server.web.apiRoute}`),
      "",
    );

    for (const action of api.actions.actions) {
      if (!action?.web?.route) continue;

      const matcher =
        action.web.route instanceof RegExp
          ? action.web.route
          : new RegExp(`^${action.web.route}$`);

      if (
        pathToMatch &&
        pathToMatch.match(matcher) &&
        method.toUpperCase() === action.web.method
      ) {
        return action.name;
      }
    }
  }
}

const buildHeaders = (connection?: Connection) => {
  const headers: Record<string, string> = {};

  headers["Content-Type"] = "application/json";
  headers["X-SERVER-NAME"] = config.process.name;
  headers["Access-Control-Allow-Origin"] = config.server.web.allowedOrigins;
  headers["Access-Control-Allow-Methods"] = config.server.web.allowedMethods;
  headers["Access-Control-Allow-Credentials"] = "true";

  if (connection) {
    headers["Set-Cookie"] =
      `${config.session.cookieName}=${connection.id}; Max-Age=${config.session.ttl}; Path=/; HttpOnly`;
  }

  return headers;
};

function buildResponse(
  connection: Connection,
  response: Object,
  res: ServerResponse,
  status = 200,
) {
  const headers = buildHeaders(connection);
  res.writeHead(status, headers);
  res.end(JSON.stringify(response, null, 2) + EOL);
}

function buildError(
  connection: Connection | undefined,
  error: TypedError,
  res: ServerResponse,
  status = 500,
) {
  const headers = buildHeaders(connection);
  res.writeHead(status, headers);
  res.end(JSON.stringify({ error: buildErrorPayload(error) }, null, 2) + EOL);
}

function buildErrorPayload(error: TypedError) {
  return {
    message: error.message,
    type: error.type,
    timestamp: new Date().getTime(),
    key: error.key !== undefined ? error.key : undefined,
    value: error.value !== undefined ? error.value : undefined,
    stack: error.stack,
  };
}

const EOL = "\r\n";
