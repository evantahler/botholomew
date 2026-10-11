import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api } from "keryx";
import {
  NEVER_MCP_ACTION_NAMES,
  shouldPublishAsMcpTool,
} from "../../ops/McpToolPolicyOps";
import {
  buildTestUniverse,
  getMcpAccessToken,
  HOOK_TIMEOUT,
  TEST_PASSWORD,
  type TestUniverse,
} from "../setup";

let universe: TestUniverse;
let url: string;

/** One JSON-RPC exchange with the MCP endpoint. */
interface McpResult {
  status: number;
  sessionId: string | null;
  body: Record<string, unknown> | null;
}

/**
 * Post one JSON-RPC message to `/mcp`.
 *
 * A hand-rolled client rather than the SDK's, because what is under test is our
 * side of the boundary — which tools a person's OAuth token sees, and which
 * project's data those tools hand it. Pulling in a client library would
 * test the library.
 *
 * The response is `text/event-stream` for a request the server streams, so the
 * JSON has to be dug out of the `data:` line either way.
 * @param token - The bearer token to present.
 * @param message - The JSON-RPC message.
 * @param sessionId - The session id from a previous `initialize`, if any.
 * @returns The status, any session id, and the parsed result.
 */
async function mcp(
  token: string,
  message: Record<string, unknown>,
  sessionId?: string,
): Promise<McpResult> {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });

  const text = await res.text();
  let body: Record<string, unknown> | null = null;

  if (text.trim() !== "") {
    const payload = text.includes("data:")
      ? (text
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim() ?? "")
      : text;
    try {
      body = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body,
  };
}

/**
 * Open an MCP session with a bearer token.
 * @param token - The bearer token.
 * @returns The negotiated session id.
 * @throws {Error} If the server refused to initialize the session.
 */
async function openSession(token: string): Promise<string> {
  const init = await mcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "botholomew-test", version: "0" },
    },
  });

  if (!init.sessionId) {
    throw new Error(
      `MCP initialize returned no session (status ${init.status}): ${JSON.stringify(init.body)}`,
    );
  }

  await mcp(
    token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    init.sessionId,
  );

  return init.sessionId;
}

/**
 * Call one MCP tool.
 * @param token - The bearer token.
 * @param sessionId - An initialized session.
 * @param name - The tool name.
 * @param args - The tool's arguments.
 * @returns The JSON-RPC response.
 */
async function callTool(
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpResult> {
  return await mcp(
    token,
    {
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId,
  );
}

/**
 * Whether a tool result came back as an error.
 * @param result - The JSON-RPC exchange.
 * @returns True for a tool error or a JSON-RPC error.
 */
function isToolError(result: McpResult): boolean {
  const payload = result.body?.result as { isError?: boolean } | undefined;
  return payload?.isError === true || result.body?.error !== undefined;
}

/**
 * The text of a tool result, whatever shape it arrived in.
 * @param result - The JSON-RPC exchange.
 * @returns Every text content part, joined.
 */
function toolText(result: McpResult): string {
  const payload = result.body?.result as
    | { content?: { text?: string }[] }
    | undefined;
  return (payload?.content ?? []).map((c) => c.text ?? "").join("");
}

/**
 * The tool names a session's `tools/list` reports.
 * @param token - The bearer token.
 * @param sessionId - An initialized session.
 * @returns Every tool name, sorted.
 */
async function listToolNames(
  token: string,
  sessionId: string,
): Promise<string[]> {
  const list = await mcp(
    token,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    sessionId,
  );
  const tools = (list.body?.result as { tools?: { name: string }[] })?.tools;
  return (tools ?? []).map((t) => t.name).sort();
}

beforeAll(async () => {
  universe = await buildTestUniverse();
  url = universe.url;
}, HOOK_TIMEOUT);

afterAll(async () => {
  await api.stop();
}, HOOK_TIMEOUT);

describe("a person's OAuth client", () => {
  test("sees exactly the published shell set", async () => {
    const token = await getMcpAccessToken(
      url,
      universe.peach.email,
      TEST_PASSWORD,
    );
    const session = await openSession(token);
    const names = await listToolNames(token, session);

    // Derived from the live registry and the policy function, so this is the
    // assertion that Keryx registered what the policy published — no more (a
    // never-MCP action leaking through) and no less (a published action Keryx
    // dropped).
    const published = api.actions.actions
      .filter((a) => shouldPublishAsMcpTool(a))
      .map((a) => a.name.replace(/:/g, "-"))
      .sort();
    expect(names).toEqual(published);

    // And spelled out, because a whole-set equality against a derived value
    // proves agreement, not intent. This is the shell's product surface.
    expect(names).toEqual(
      [
        "audit-list",
        "invite-accept",
        "invite-create",
        "invite-list",
        "invite-list-pending",
        "invite-reject",
        "me-view",
        "membership-create",
        "membership-delete",
        "membership-list",
        "project-create",
        "project-delete",
        "project-edit",
        "project-list",
        "project-view",
        "tag-create",
        "tag-delete",
        "tag-edit",
        "tag-list",
        "user-edit",
        "user-tag-assign",
        "user-tag-remove",
      ].sort(),
    );
  });

  test("never sees a never-MCP action, a sweep, or a login hop", async () => {
    const token = await getMcpAccessToken(
      url,
      universe.toad.email,
      TEST_PASSWORD,
    );
    const session = await openSession(token);
    const names = new Set(await listToolNames(token, session));
    expect(names.size).toBeGreaterThan(0);

    for (const name of [
      ...NEVER_MCP_ACTION_NAMES,
      "audit:sweep",
      "invites:sweep",
    ]) {
      expect(names.has(name.replace(/:/g, "-")), name).toBe(false);
    }
  });

  test("an unauthenticated MCP request never reaches a tool", async () => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("project data over MCP", () => {
  test("a member can list their own project's members through their client", async () => {
    // The reason the shell's reads are tools at all: "who is on this project",
    // asked of your own Claude, answered from the real membership table.
    const token = await getMcpAccessToken(
      url,
      universe.peach.email,
      TEST_PASSWORD,
    );
    const session = await openSession(token);

    const result = await callTool(token, session, "membership-list", {
      projectId: universe.projectId,
    });

    expect(isToolError(result)).toBe(false);
    const text = toolText(result);
    for (const member of [
      universe.peach,
      universe.mario,
      universe.luigi,
      universe.toad,
    ]) {
      expect(text).toContain(member.email);
    }
    expect(text).not.toContain(universe.bowser.email);
  });

  test("an outsider's client is refused another project's membership-list", async () => {
    const token = await getMcpAccessToken(
      url,
      universe.bowser.email,
      TEST_PASSWORD,
    );
    const session = await openSession(token);

    const result = await callTool(token, session, "membership-list", {
      projectId: universe.projectId,
    });

    expect(isToolError(result)).toBe(true);
    expect(toolText(result)).not.toContain(universe.peach.email);
  });

  test("a plain member's client is refused an admin tool", async () => {
    const token = await getMcpAccessToken(
      url,
      universe.toad.email,
      TEST_PASSWORD,
    );
    const session = await openSession(token);

    const result = await callTool(token, session, "tag-create", {
      projectId: universe.projectId,
      name: "toads-own-tag",
    });

    expect(isToolError(result)).toBe(true);
  });
});
