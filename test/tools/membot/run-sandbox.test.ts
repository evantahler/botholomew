import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  invokeSandbox,
  type SandboxOutcome,
} from "../../../src/tools/membot/run/execute.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

function completedResult(outcome: SandboxOutcome): unknown {
  expect(outcome.status).toBe("completed");
  if (outcome.status !== "completed") throw new Error("expected completed");
  expect(outcome.output.is_error).toBe(false);
  return "result" in outcome.output ? outcome.output.result : undefined;
}

/** An escape attempt is contained if the run fails or reports escaped=false. */
function expectContained(outcome: SandboxOutcome): void {
  if (outcome.status === "failed") {
    expect(outcome.output.is_error).toBe(true);
    return;
  }
  expect(outcome.status).toBe("completed");
  if (outcome.status !== "completed") return;
  const result = "result" in outcome.output ? outcome.output.result : undefined;
  if (result && typeof result === "object" && result !== null) {
    expect(result).toMatchObject({ escaped: false });
    return;
  }
  throw new Error(
    `escape attempt completed with unexpected result: ${JSON.stringify(result)}`,
  );
}

const ESCAPE_SNIPPETS: { name: string; source: string }[] = [
  {
    name: "eval",
    source: `try { return { escaped: true, value: eval("1+1") }; } catch { return { escaped: false }; }`,
  },
  {
    name: "Function constructor",
    source: `try { return { escaped: true, value: Function("return 1")() }; } catch { return { escaped: false }; }`,
  },
  {
    name: "new Function",
    source: `try { return { escaped: true, value: new Function("return 1")() }; } catch { return { escaped: false }; }`,
  },
  {
    name: "function constructor climb",
    source: `try {
      const F = (function () {}).constructor;
      return { escaped: true, value: F("return 1")() };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "AsyncFunction constructor",
    source: `try {
      const F = Object.getPrototypeOf(async function () {}).constructor;
      const value = F("return 1")();
      return { escaped: true, value: await value };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "array constructor climb",
    source: `try {
      const F = [].constructor.constructor;
      return { escaped: true, value: F("return 1")() };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "Reflect.construct Function",
    source: `try {
      const F = Reflect.construct(Function, ["return 1"]);
      return { escaped: true, value: F() };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "dynamic import fs",
    source: `try {
      const mod = await import("fs");
      return { escaped: true, value: Object.keys(mod) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "dynamic import node:child_process",
    source: `try {
      const mod = await import("node:child_process");
      return { escaped: true, value: typeof mod.spawn };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "dynamic import bun:ffi",
    source: `try {
      const mod = await import("bun:ffi");
      return { escaped: true, value: typeof mod.dlopen };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "dynamic import https URL",
    source: `try {
      const mod = await import("https://example.com/mod.js");
      return { escaped: true, value: mod };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "require child_process",
    source: `try {
      const cp = require("child_process");
      return { escaped: true, value: typeof cp.spawn };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "require('fs').readFileSync",
    source: `try {
      const text = require("fs").readFileSync("/etc/passwd", "utf8");
      return { escaped: true, value: text.slice(0, 20) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "globalThis.process.env",
    source: `try {
      const env = globalThis.process.env;
      return { escaped: true, value: env };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "Bun.spawn",
    source: `try {
      const proc = Bun.spawn(["echo", "pwned"]);
      return { escaped: true, value: typeof proc };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "Bun.file host read",
    source: `try {
      const text = await Bun.file("/etc/passwd").text();
      return { escaped: true, value: text.slice(0, 20) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "Deno.readTextFile",
    source: `try {
      const text = await Deno.readTextFile("/etc/passwd");
      return { escaped: true, value: text.slice(0, 20) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "WebSocket",
    source: `try {
      const ws = new WebSocket("wss://example.com");
      return { escaped: true, value: String(ws) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "XMLHttpRequest",
    source: `try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://example.com");
      xhr.send();
      return { escaped: true, value: "sent" };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "Worker",
    source: `try {
      const w = new Worker("data:text/javascript,postMessage(1)");
      return { escaped: true, value: String(w) };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "setTimeout",
    source: `try {
      setTimeout(() => {}, 0);
      return { escaped: true, value: "timer" };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "setInterval",
    source: `try {
      setInterval(() => {}, 0);
      return { escaped: true, value: "timer" };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "invented fs host group",
    source: `try {
      const text = await fs.readFile("/etc/passwd");
      return { escaped: true, value: text };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "invented process host group",
    source: `try {
      return { escaped: true, value: process.env };
    } catch { return { escaped: false }; }`,
  },
  {
    name: "mcp as a Botholomew tool dispatcher",
    source: `try {
      const r = await mcp.exec("botholomew", "spawn_worker", {});
      return { escaped: true, value: r };
    } catch { return { escaped: false }; }`,
  },
];

describe("membot_run sandbox isolation", () => {
  test("dangerous ambient globals are missing", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `
        let requireFs = "threw";
        try {
          require("fs");
          requireFs = "loaded";
        } catch {
          requireFs = "threw";
        }
        return {
          process: typeof process,
          bun: typeof Bun,
          deno: typeof Deno,
          fetch: typeof fetch,
          require: typeof require,
          requireFs,
          eval: typeof eval,
          Function: typeof Function,
          setTimeout: typeof setTimeout,
          setInterval: typeof setInterval,
          setImmediate: typeof setImmediate,
          queueMicrotask: typeof queueMicrotask,
          Worker: typeof Worker,
          WebSocket: typeof WebSocket,
          XMLHttpRequest: typeof XMLHttpRequest,
          EventSource: typeof EventSource,
          navigator: typeof navigator,
          window: typeof window,
          document: typeof document,
          localStorage: typeof localStorage,
          crypto: typeof crypto,
          performance: typeof performance,
          Buffer: typeof Buffer,
          std: typeof std,
          os: typeof os,
          qjs: typeof qjs,
          Deno: typeof Deno,
          caches: typeof caches,
          indexedDB: typeof indexedDB,
          importScripts: typeof importScripts,
          SharedArrayBuffer: typeof SharedArrayBuffer,
        };
      `,
    });
    const result = completedResult(outcome) as Record<string, string>;
    expect(result.process).toBe("undefined");
    expect(result.bun).toBe("undefined");
    expect(result.deno).toBe("undefined");
    expect(result.fetch).toBe("undefined");
    expect(result.requireFs).toBe("threw");
    expect(result.setTimeout).toBe("undefined");
    expect(result.setInterval).toBe("undefined");
    expect(result.Worker).toBe("undefined");
    expect(result.WebSocket).toBe("undefined");
    expect(result.XMLHttpRequest).toBe("undefined");
    expect(result.EventSource).toBe("undefined");
    expect(result.navigator).toBe("undefined");
    expect(result.window).toBe("undefined");
    expect(result.document).toBe("undefined");
    expect(result.localStorage).toBe("undefined");
    expect(result.crypto).toBe("undefined");
    expect(result.performance).toBe("undefined");
    expect(result.Buffer).toBe("undefined");
    expect(result.std).toBe("undefined");
    expect(result.os).toBe("undefined");
    expect(result.Deno).toBe("undefined");
    expect(result.caches).toBe("undefined");
    expect(result.indexedDB).toBe("undefined");
    expect(result.importScripts).toBe("undefined");
  });

  test("files and mcp are the only extra host globals", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `
        const names = Object.getOwnPropertyNames(globalThis);
        return {
          names,
          filesType: typeof files,
          mcpType: typeof mcp,
          fileMethods: {
            readJson: typeof files.readJson,
            readText: typeof files.readText,
            writeJson: typeof files.writeJson,
            writeText: typeof files.writeText,
            exists: typeof files.exists,
            info: typeof files.info,
            list: typeof files.list,
            search: typeof files.search,
          },
          mcpMethods: {
            listTools: typeof mcp.listTools,
            search: typeof mcp.search,
            info: typeof mcp.info,
            exec: typeof mcp.exec,
            capture: typeof mcp.capture,
          },
        };
      `,
    });
    const result = completedResult(outcome) as {
      names: string[];
      filesType: string;
      mcpType: string;
      fileMethods: Record<string, string>;
      mcpMethods: Record<string, string>;
    };
    expect(["function", "object"]).toContain(result.filesType);
    expect(["function", "object"]).toContain(result.mcpType);
    expect(result.fileMethods).toEqual({
      readJson: "function",
      readText: "function",
      writeJson: "function",
      writeText: "function",
      exists: "function",
      info: "function",
      list: "function",
      search: "function",
    });
    expect(result.mcpMethods).toEqual({
      listTools: "function",
      search: "function",
      info: "function",
      exec: "function",
      capture: "function",
    });
    expect(result.names).toContain("files");
    expect(result.names).toContain("mcp");
    expect(result.names).not.toContain("process");
    expect(result.names).not.toContain("Bun");
    expect(result.names).not.toContain("fetch");
    expect(result.names).not.toContain("require");
  });

  test("dynamic evaluation is rejected", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `return eval("1+1");`,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(["invalid_source", "internal_error", "host_error"]).toContain(
      outcome.output.error_type,
    );
  });

  test("syntax errors map to invalid_source", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `const x = {`,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("invalid_source");
    expect(outcome.output.next_action_hint).toContain("files.readJson");
  });

  test("tight loops hit the sandbox timeout", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `let n = 0; while (true) n++; return n;`,
      limits: { timeoutMs: 200 },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("sandbox_timeout");
  });

  test("static import is rejected", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `import fs from "fs"; return fs;`,
    });
    expect(outcome.status).toBe("failed");
  });

  test("oversized result hits sandbox_limit", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `return "x".repeat(2000);`,
      limits: { maxResultBytes: 64 },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("sandbox_limit");
  });

  test("too many host calls hit sandbox_limit", async () => {
    await ctx.withMem((mem) =>
      mem.write({ logical_path: "n.json", content: "1" }),
    );
    const outcome = await invokeSandbox(ctx, {
      source: `
        for (let i = 0; i < 8; i++) {
          await files.exists("n.json");
        }
        return true;
      `,
      limits: { maxBridgeRequests: 3 },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.error_type).toBe("sandbox_limit");
  });
});

describe("membot_run sandbox escape attempts", () => {
  for (const attempt of ESCAPE_SNIPPETS) {
    test(`cannot ${attempt.name}`, async () => {
      const outcome = await invokeSandbox(ctx, { source: attempt.source });
      expectContained(outcome);
    });
  }

  test("cannot fetch a live HTTP server via any network API", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return new Response("pwned-from-host");
      },
    });
    const url = server.url.href;
    try {
      const outcome = await invokeSandbox(ctx, {
        source: `
          const url = ${JSON.stringify(url)};
          const probes = [];
          async function tryCall(label, fn) {
            try {
              const value = await fn();
              probes.push({ label, escaped: true, value: String(value) });
            } catch (err) {
              probes.push({ label, escaped: false, error: String(err) });
            }
          }
          await tryCall("fetch", () => fetch(url));
          await tryCall("globalThis.fetch", () => globalThis.fetch(url));
          await tryCall("globalThis['fetch']", () => globalThis["fetch"](url));
          await tryCall("XMLHttpRequest", () => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.send();
            return xhr.responseText;
          });
          await tryCall("EventSource", () => new EventSource(url));
          await tryCall("WebSocket", () => new WebSocket(url.replace("http", "ws")));
          await tryCall("navigator.sendBeacon", () => navigator.sendBeacon(url, "x"));
          return { probes };
        `,
      });
      expect(hits).toBe(0);
      if (outcome.status === "completed") {
        const result = completedResult(outcome) as {
          probes: { label: string; escaped: boolean; value?: string }[];
        };
        expect(result.probes.every((p) => p.escaped === false)).toBe(true);
        expect(
          result.probes.some((p) => String(p.value ?? "").includes("pwned")),
        ).toBe(false);
      } else {
        expect(outcome.status).toBe("failed");
      }
    } finally {
      server.stop(true);
    }
  });

  test("cannot read or overwrite host filesystem paths through files.*", async () => {
    const secretPath = join(ctx.projectDir, "secret-on-disk.txt");
    await writeFile(secretPath, "host-secret-do-not-leak");
    const outsideDir = join(ctx.projectDir, "..", `both-escape-${Date.now()}`);
    await mkdir(outsideDir, { recursive: true });
    const outsidePath = join(outsideDir, "outside.txt");
    await writeFile(outsidePath, "outside-secret");

    const outcome = await invokeSandbox(ctx, {
      source: `
        const attempts = [
          ${JSON.stringify(secretPath)},
          ${JSON.stringify(outsidePath)},
          "/etc/passwd",
          "../../etc/passwd",
          "secret-on-disk.txt",
          "../secret-on-disk.txt",
        ];
        const reads = [];
        for (const path of attempts) {
          try {
            const text = await files.readText(path);
            reads.push({ path, text: String(text) });
          } catch (err) {
            reads.push({ path, error: String(err) });
          }
        }
        try {
          await files.writeText(${JSON.stringify(secretPath)}, "pwned-membot", "escape");
          reads.push({ path: "write-abs", wrote: true });
        } catch (err) {
          reads.push({ path: "write-abs", error: String(err) });
        }
        return { reads };
      `,
    });

    const onDisk = await readFile(secretPath, "utf8");
    expect(onDisk).toBe("host-secret-do-not-leak");
    const outside = await readFile(outsidePath, "utf8");
    expect(outside).toBe("outside-secret");

    const result = completedResult(outcome) as {
      reads: { path: string; text?: string; wrote?: boolean }[];
    };
    for (const read of result.reads) {
      expect(read.text ?? "").not.toContain("host-secret-do-not-leak");
      expect(read.text ?? "").not.toContain("outside-secret");
      expect(read.text ?? "").not.toMatch(/^root:/);
    }
  });

  test("replacing files.readJson cannot reach fetch or host files", async () => {
    await ctx.withMem((mem) =>
      mem.write({
        logical_path: "seeded.json",
        content: JSON.stringify({ ok: true }),
      }),
    );
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return new Response("pwned");
      },
    });
    try {
      const outcome = await invokeSandbox(ctx, {
        source: `
          try { files.readJson = async () => fetch(${JSON.stringify(server.url.href)}); } catch {}
          try { files.readText = async () => require("fs").readFileSync("/etc/passwd", "utf8"); } catch {}
          const value = await files.readJson("seeded.json");
          return value;
        `,
      });
      expect(hits).toBe(0);
      if (outcome.status === "completed") {
        expect(completedResult(outcome)).toEqual({ ok: true });
      }
    } finally {
      server.stop(true);
    }
  });

  test("prototype pollution cannot reach a live HTTP server or Node process", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return new Response("pwned-from-host");
      },
    });
    try {
      const outcome = await invokeSandbox(ctx, {
        source: `
          try { Object.prototype.fetch = () => "polluted"; } catch {}
          try { Object.prototype.process = { env: { HOME: "/pwned" } }; } catch {}
          let fetchResult = null;
          let fetchError = null;
          try { fetchResult = await fetch(${JSON.stringify(server.url.href)}); }
          catch (err) { fetchError = String(err); }
          let envHome = null;
          try { envHome = process.env.HOME; } catch {}
          return {
            fetchResult: fetchResult == null ? null : String(fetchResult),
            fetchError,
            envHome,
            processType: typeof process,
          };
        `,
      });
      expect(hits).toBe(0);
      if (outcome.status !== "completed") return;
      const result = completedResult(outcome) as {
        fetchResult: string | null;
        envHome: string | null;
        processType: string;
      };
      expect(String(result.fetchResult ?? "")).not.toContain("pwned-from-host");
      expect(result.envHome).not.toBe(process.env.HOME);
    } finally {
      server.stop(true);
    }
  });
});
