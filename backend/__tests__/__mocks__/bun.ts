import { fileURLToPath } from "url";
import { dirname } from "path";
import { readdir } from "fs/promises";
import { join, relative } from "path";

// Mock Bun's Glob class with actual file scanning
export class Glob {
  private pattern: string;
  
  constructor(pattern: string) {
    this.pattern = pattern;
  }
  
  async *scan(dir: string): AsyncGenerator<string> {
    // Parse pattern like "**/*.{ts,tsx}"
    const matchPattern = this.pattern.replace("**/", "").replace("{ts,tsx}", "ts");
    const extensions = matchPattern.match(/\{([^}]+)\}/)?.[1]?.split(",") || ["ts"];
    
    // Recursively scan directory
    async function* scanDir(currentDir: string, baseDir: string): AsyncGenerator<string> {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            // Skip hidden directories and node_modules
            if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
              yield* scanDir(fullPath, baseDir);
            }
          } else if (entry.isFile()) {
            // Check if file matches pattern
            const ext = entry.name.split(".").pop();
            if (ext && extensions.includes(ext)) {
              const relPath = relative(baseDir, fullPath);
              yield relPath.replace(/\\/g, "/"); // Normalize path separators
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    }
    
    yield* scanDir(dir, dir);
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
      // Mock password hashing - use bcrypt-like approach for testing
      // Generate different hashes for same password by using salt
      const crypto = await import("crypto");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.createHash("sha256").update(password + salt).digest("hex");
      // Return salt:hash format similar to bcrypt
      return `${salt}:${hash}`;
    },
    verify: async (password: string, hash: string) => {
      const crypto = await import("crypto");
      // Handle both formats: salt:hash and plain hash
      if (hash.includes(":")) {
        const [salt, hashPart] = hash.split(":");
        const testHash = crypto.createHash("sha256").update(password + salt).digest("hex");
        return testHash === hashPart;
      } else {
        // Fallback for old format - try to verify against stored hash
        // This won't work perfectly but allows tests to pass
        return false;
      }
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

