import { fileURLToPath } from "url";
import { dirname } from "path";

// Mock Bun's Glob class
export class Glob {
  constructor(pattern: string) {}
  async *scan(dir: string): AsyncGenerator<string> {
    // Mock implementation - return empty for now
    // Tests that need actual globbing will need to override this
  }
}

// Mock Bun's $ (shell)
export const $ = {
  // Mock shell execution
  exec: async (command: string) => {
    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

// Mock ServerWebSocket type
export type ServerWebSocket<T = any> = any;

// Mock Bun global object
export const Bun = {
  env: process.env as any,
  file: (path: string) => ({
    text: async () => "",
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  }),
  write: async (path: string, data: any) => {},
  readFile: async (path: string) => "",
  spawn: (args: string[]) => ({
    exited: Promise.resolve({ exitCode: 0 }),
  }),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  password: {
    hash: async (password: string) => {
      // Mock password hashing - use a simple hash for testing
      const crypto = await import("crypto");
      return crypto.createHash("sha256").update(password).digest("hex");
    },
    verify: async (password: string, hash: string) => {
      const crypto = await import("crypto");
      const testHash = crypto.createHash("sha256").update(password).digest("hex");
      return testHash === hash;
    },
  },
  randomUUIDv7: () => {
    // Mock UUID generation
    return crypto.randomUUID();
  },
  serve: (options: any) => {
    // Mock Bun.serve - return a mock server object
    return {
      port: options.port || 3000,
      hostname: options.hostname || "localhost",
      stop: async () => {},
    };
  },
};

// Make Bun available globally
(globalThis as any).Bun = Bun;

// Mock import.meta for Node.js compatibility
// This needs to be set up before any imports that use import.meta.path
if (typeof import.meta.url !== "undefined") {
  Object.defineProperty(import.meta, "path", {
    get: () => {
      if (import.meta.url) {
        return fileURLToPath(import.meta.url);
      }
      return __filename || process.cwd();
    },
    configurable: true,
  });
}

