import {
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { api, config } from "../../api";
import { WebSocket } from "ws";
import { USERS } from "../utils/testHelpers";

const url = config.server.web.applicationUrl;
const wsUrl = url.replace("http", "ws") + "/ws";

describe("WebSocket Server", () => {
  let ws: WebSocket;

  beforeAll(async () => {
    await api.start();
    await api.db.clearDatabase();
  });

  afterAll(async () => {
    await Bun.sleep(500);
    await api.stop();
  });

  afterEach(async () => {
    await Bun.sleep(100);
    if (ws) ws.close();
  });

  describe("connection", () => {
    test("can connect to WebSocket server", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        done();
      });
    });

    test("receives connection confirmation", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        // Send a ping to test the connection
        ws.send(JSON.stringify({ messageType: "ping" }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        expect(message).toBeDefined();
        done();
      });
    });
  });

  describe("user actions", () => {
    test("can create user via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const messageId = "test-create-user-" + Date.now();
        const createUserMessage = {
          messageType: "action",
          messageId,
          action: "user:create",
          params: {
            name: USERS.MARIO.name,
            email: USERS.MARIO.email,
            password: USERS.MARIO.password,
          },
        };

        ws.send(JSON.stringify(createUserMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.response) {
          expect(message.response.user).toBeDefined();
          expect(message.response.user.name).toBe(USERS.MARIO.name);
          expect(message.response.user.email).toBe(USERS.MARIO.email);
          expect(message.response.user.id).toBeDefined();
          done();
        }
      });
    });

    test("can edit user via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", async () => {
        // First create a user
        const createMessageId = "test-create-user-" + Date.now();
        const createUserMessage = {
          messageType: "action",
          messageId: createMessageId,
          action: "user:create",
          params: {
            name: USERS.LUIGI.name,
            email: USERS.LUIGI.email,
            password: USERS.LUIGI.password,
          },
        };

        ws.send(JSON.stringify(createUserMessage));
      });

      let userCreated = false;
      let sessionCreated = false;
      let userId: number;
      let sessionId: string;

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.response && !userCreated) {
          // User was created, now create a session
          userCreated = true;
          userId = message.response.user.id;

          const sessionMessageId = "test-create-session-" + Date.now();
          const createSessionMessage = {
            messageType: "action",
            messageId: sessionMessageId,
            action: "session:create",
            params: {
              email: USERS.LUIGI.email,
              password: USERS.LUIGI.password,
            },
          };

          ws.send(JSON.stringify(createSessionMessage));
        } else if (
          message.messageId &&
          message.response &&
          userCreated &&
          !sessionCreated
        ) {
          // Session was created, now edit the user
          sessionCreated = true;
          sessionId = message.response.session.id;

          const editMessageId = "test-edit-user-" + Date.now();
          const editUserMessage = {
            messageType: "action",
            messageId: editMessageId,
            action: "user:edit",
            params: {
              name: "Luigi Mario Updated",
            },
          };

          ws.send(JSON.stringify(editUserMessage));
        } else if (
          message.messageId &&
          message.response &&
          userCreated &&
          sessionCreated
        ) {
          // User was edited
          expect(message.response.user).toBeDefined();
          expect(message.response.user.name).toBe("Luigi Mario Updated");
          expect(message.response.user.email).toBe(USERS.LUIGI.email);
          expect(message.response.user.id).toBe(userId);
          done();
        }
      });
    });

    test("handles validation errors via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const messageId = "test-validation-error-" + Date.now();
        const invalidUserMessage = {
          messageType: "action",
          messageId,
          action: "user:create",
          params: {
            name: "x", // Too short
            email: "invalid-email",
            password: "z", // Too short
          },
        };

        ws.send(JSON.stringify(invalidUserMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.error) {
          expect(message.error.message).toContain(
            "This field is required and must be at least 3 characters long",
          );
          expect(message.error.key).toBe("name");
          expect(message.error.value).toBe("x");
          done();
        }
      });
    });

    test("handles duplicate email error via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const messageId = "test-duplicate-email-" + Date.now();
        const duplicateUserMessage = {
          messageType: "action",
          messageId,
          action: "user:create",
          params: {
            name: USERS.MARIO.name,
            email: USERS.MARIO.email, // This email already exists
            password: USERS.MARIO.password,
          },
        };

        ws.send(JSON.stringify(duplicateUserMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.error) {
          expect(message.error.message.toLowerCase()).toMatch(
            /user already exists/,
          );
          done();
        }
      });
    });
  });

  describe("session actions", () => {
    test("can create session via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", async () => {
        // First create a user
        const createMessageId = "test-create-user-session-" + Date.now();
        const createUserMessage = {
          messageType: "action",
          messageId: createMessageId,
          action: "user:create",
          params: {
            name: USERS.BOWSER.name,
            email: USERS.BOWSER.email,
            password: USERS.BOWSER.password,
          },
        };

        ws.send(JSON.stringify(createUserMessage));
      });

      let userCreated = false;

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.response && !userCreated) {
          // User was created, now create a session
          userCreated = true;

          const sessionMessageId = "test-create-session-" + Date.now();
          const createSessionMessage = {
            messageType: "action",
            messageId: sessionMessageId,
            action: "session:create",
            params: {
              email: USERS.BOWSER.email,
              password: USERS.BOWSER.password,
            },
          };

          ws.send(JSON.stringify(createSessionMessage));
        } else if (message.messageId && message.response && userCreated) {
          // Session was created
          expect(message.response.user).toBeDefined();
          expect(message.response.session).toBeDefined();
          expect(message.response.user.email).toBe(USERS.BOWSER.email);
          expect(message.response.session.id).toBeDefined();
          done();
        }
      });
    });

    test("handles invalid login via WebSocket", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const messageId = "test-invalid-login-" + Date.now();
        const invalidLoginMessage = {
          messageType: "action",
          messageId,
          action: "session:create",
          params: {
            email: "nonexistent@example.com",
            password: "wrongpassword",
          },
        };

        ws.send(JSON.stringify(invalidLoginMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.error) {
          expect(message.error.message.toLowerCase()).toMatch(/user not found/);
          done();
        }
      });
    });
  });

  describe("message handling", () => {
    test("handles invalid message type", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const invalidMessage = {
          messageType: "invalid-type",
          messageId: "test-invalid-" + Date.now(),
        };

        ws.send(JSON.stringify(invalidMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.error) {
          expect(message.error.message).toContain(
            "messageType either missing or unknown",
          );
          done();
        }
      });
    });

    test("handles malformed JSON", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        ws.send("invalid json message");
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.error) {
          expect(message.error.message).toContain("JSON Parse error");
          done();
        }
      });
    });
  });

  describe("subscription handling", () => {
    test("can subscribe to channels", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const subscribeMessage = {
          messageType: "subscribe",
          messageId: "test-subscribe-" + Date.now(),
          channel: "test-channel",
        };

        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.subscribed) {
          expect(message.subscribed.channel).toBe("test-channel");
          done();
        }
      });
    });

    test("can unsubscribe from channels", (done) => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        const unsubscribeMessage = {
          messageType: "unsubscribe",
          messageId: "test-unsubscribe-" + Date.now(),
          channel: "test-channel",
        };

        ws.send(JSON.stringify(unsubscribeMessage));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());

        if (message.messageId && message.unsubscribed) {
          expect(message.unsubscribed.channel).toBe("test-channel");
          done();
        }
      });
    });
  });
});
