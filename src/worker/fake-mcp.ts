/**
 * Canned MCP responses for capture mode (BOTHOLOMEW_FAKE_LLM=1). Lets
 * `mcp_search` and `mcp_exec` return demo-friendly results without requiring
 * a live MCPX gateway. The shapes mirror what the real tools emit.
 */

export interface FakeMcpSearchResult {
  server: string;
  tool: string;
  description: string;
  score: number;
  match_type: string;
}

export function isCaptureMode(): boolean {
  return process.env.BOTHOLOMEW_FAKE_LLM === "1";
}

export function fakeMcpSearch(query: string): FakeMcpSearchResult[] | null {
  const q = query.toLowerCase();
  if (/calendar|schedule|event|meeting/.test(q)) {
    return [
      {
        server: "google-calendar",
        tool: "ListEvents",
        description:
          "List events on a user's Google Calendar within a date range.",
        score: 0.94,
        match_type: "semantic",
      },
      {
        server: "google-calendar",
        tool: "CreateEvent",
        description: "Create a new event on a user's Google Calendar.",
        score: 0.78,
        match_type: "semantic",
      },
    ];
  }
  if (/email|gmail|mail/.test(q)) {
    return [
      {
        server: "gmail",
        tool: "SendEmail",
        description: "Send an email from the user's Gmail account.",
        score: 0.91,
        match_type: "semantic",
      },
    ];
  }
  return null;
}

export function fakeMcpExec(
  server: string,
  tool: string,
  _args: Record<string, unknown> | undefined,
): string | null {
  if (server === "google-calendar" && tool === "ListEvents") {
    return JSON.stringify(
      {
        events: [
          { start: "09:00", summary: "Sprint planning" },
          { start: "11:30", summary: "Design review with Pascal" },
          { start: "14:00", summary: "Focus block: v0.8 roadmap" },
          { start: "16:30", summary: "1:1 with Sterling" },
        ],
      },
      null,
      2,
    );
  }
  return null;
}
