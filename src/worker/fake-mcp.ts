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
  if (/google.*doc|docs?\.google|gdoc|document/.test(q)) {
    return [
      {
        server: "google-docs",
        tool: "GetDocumentAsMarkdown",
        description:
          "Fetch the contents of a Google Doc by URL or ID and return it as Markdown.",
        score: 0.96,
        match_type: "semantic",
      },
      {
        server: "google-docs",
        tool: "GetDocumentAsHtml",
        description: "Fetch a Google Doc as raw HTML.",
        score: 0.71,
        match_type: "semantic",
      },
    ];
  }
  if (/github|pull request|\bpr\b|repo|commit/.test(q)) {
    return [
      {
        server: "github",
        tool: "ListMyPullRequests",
        description:
          "List the user's recent pull requests across all repos, with status and last activity.",
        score: 0.93,
        match_type: "semantic",
      },
      {
        server: "github",
        tool: "ListAssignedIssues",
        description: "List GitHub issues assigned to the user.",
        score: 0.79,
        match_type: "semantic",
      },
    ];
  }
  if (/linear|ticket|issue.*track/.test(q)) {
    return [
      {
        server: "linear",
        tool: "ListMyIssues",
        description:
          "List Linear issues assigned to the user, including status and any blocking notes.",
        score: 0.95,
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
  if (server === "github" && tool === "ListMyPullRequests") {
    return JSON.stringify(
      {
        pull_requests: [
          {
            number: 213,
            repo: "evantahler/botholomew",
            title:
              "TUI: close chat gap, hide chat scrollback on other tabs, wrap detail panes",
            status: "merged",
            merged_at: "2026-05-05T18:42:00Z",
          },
          {
            number: 214,
            repo: "evantahler/botholomew",
            title: "Make /standup demo call GitHub + Linear before synthesis",
            status: "open",
            updated_at: "2026-05-06T09:01:00Z",
            review_state: "requested_changes",
          },
        ],
      },
      null,
      2,
    );
  }
  if (server === "linear" && tool === "ListMyIssues") {
    return JSON.stringify(
      {
        issues: [
          {
            id: "ENG-487",
            title: "Worker reaper sometimes drops heartbeats under load",
            status: "in_progress",
            priority: "medium",
          },
          {
            id: "ENG-491",
            title: "Flaky context-reindex test under Bun 1.4",
            status: "blocked",
            priority: "high",
            note: "Blocked on upstream Bun fix oven-sh/bun#26081",
          },
          {
            id: "ENG-503",
            title: "Add structured event log for capabilities refresh",
            status: "todo",
            priority: "low",
          },
        ],
      },
      null,
      2,
    );
  }
  if (server === "google-docs" && tool === "GetDocumentAsMarkdown") {
    return [
      "# Botholomew v0.8 launch plan",
      "",
      "## Themes",
      "",
      "1. Better MCPX ergonomics — fewer steps to wire up a new server.",
      "2. Chat TUI polish — context indicator, idle-pause, slash menu.",
      "3. Doc captures — every GIF in the docs is hermetic + regenerable.",
      "",
      "## Milestones",
      "",
      "- [x] Move tasks/schedules/context onto disk",
      "- [x] Replace OpenAI embeddings with @huggingface/transformers",
      "- [ ] Ship `context import` for Google Docs end-to-end",
      "- [ ] Cut v0.8 release notes",
      "",
      "## Open questions",
      "",
      "- How do we version skill templates across releases?",
      "- Should `context refresh` rate-limit per source-domain?",
      "",
      "## Stakeholders",
      "",
      "- Pascal (design review)",
      "- Sterling (reliability + oncall sign-off)",
      "",
    ].join("\n");
  }
  return null;
}
