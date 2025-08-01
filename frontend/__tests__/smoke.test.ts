import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";

describe("Frontend Smoke Test", () => {
  let serverProcess: any;
  let serverUrl: string;

  beforeAll(async () => {
    // Start the Next.js development server
    serverProcess = spawn("bun", ["run", "dev"], {
      cwd: import.meta.dir,
      stdio: "pipe",
      env: { ...process.env, PORT: "3000" },
    });

    serverUrl = "http://localhost:3000";

    // Wait for server to start by polling the URL
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Server startup timeout"));
      }, 15000);

      const checkServer = async () => {
        try {
          const response = await fetch(serverUrl);
          if (response.status === 200) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkServer, 500);
          }
        } catch (error) {
          // Server not ready yet, try again
          setTimeout(checkServer, 500);
        }
      };

      // Start checking after a short delay
      setTimeout(checkServer, 1000);
    });

    // Give the server a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

  it("should start the development server", () => {
    expect(serverProcess).toBeDefined();
    expect(serverProcess.pid).toBeDefined();
  });

  it("should load the index page successfully", async () => {
    const response = await fetch(serverUrl);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("Botholomew");
    expect(html).toContain("The Greatest Agent Framework");
  });

  it("should return HTML content type", async () => {
    const response = await fetch(serverUrl);
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("text/html");
  });

  it("should have proper page structure", async () => {
    const response = await fetch(serverUrl);
    const html = await response.text();

    // Check for essential HTML elements
    expect(html).toContain("<html");
    expect(html).toContain("<head");
    expect(html).toContain("<body");
    expect(html).toContain("title"); // Check for title element (with or without attributes)
  });
});
