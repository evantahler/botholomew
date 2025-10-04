import { setMaxListeners } from "node:events";

// Increase the max listeners limit globally for all EventEmitters
// This is necessary because:
// 1. Each test file calls api.start() which initializes multiple services
// 2. Multiple services (Redis, Postgres, Resque, Web/WebSocket servers) attach event listeners
// 3. Commander.js CLI framework attaches listeners for process signals (SIGTERM, SIGINT, etc.)
// 4. With 22 test files, we exceed Node's default limit of 10 listeners per EventEmitter
// 5. This is more apparent in CI due to different Bun versions and Linux's stricter signal handling
setMaxListeners(999);
