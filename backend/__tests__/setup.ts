import { setMaxListeners } from "node:events";
import { fileURLToPath } from "url";
import * as jestGlobals from "@jest/globals";
import "./__mocks__/bun";

// Make jest available globally for tests that use jest.mock() at the top level
// In ESM mode, jest is not automatically global, so we need to provide it
(globalThis as any).jest = {
  fn: jestGlobals.jest.fn,
  mock: jestGlobals.jest.mock,
  unmock: jestGlobals.jest.unmock,
  clearAllMocks: jestGlobals.jest.clearAllMocks,
  resetAllMocks: jestGlobals.jest.resetAllMocks,
  restoreAllMocks: jestGlobals.jest.restoreAllMocks,
  spyOn: jestGlobals.jest.spyOn,
};

// Patch import.meta.path for Node.js compatibility before API is loaded
// This must happen before any imports that use import.meta.path
if (typeof import.meta !== "undefined" && !import.meta.path) {
  try {
    // Try to get the file path from import.meta.url
    const currentFile = fileURLToPath(import.meta.url);
    // Create a proxy to intercept path access
    const metaProxy = new Proxy(import.meta, {
      get(target, prop) {
        if (prop === "path") {
          return currentFile;
        }
        return (target as any)[prop];
      },
    });
    // Note: We can't actually replace import.meta, but we can ensure
    // the code checks for import.meta.url first
  } catch (e) {
    // If that fails, we'll need to handle it differently
  }
}

// Increase the max listeners limit globally for all EventEmitters
// This is necessary because:
// 1. Each test file calls api.start() which initializes multiple services
// 2. Multiple services (Redis, Postgres, Resque, Web/WebSocket servers) attach event listeners
// 3. Commander.js CLI framework attaches listeners for process signals (SIGTERM, SIGINT, etc.)
// 4. With 22 test files, we exceed Node's default limit of 10 listeners per EventEmitter
// 5. This is more apparent in CI due to different Bun versions and Linux's stricter signal handling
setMaxListeners(999);
