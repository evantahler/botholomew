# Milestone 8: Remote Context

## Goal

Extend `botholomew context add` to accept URLs alongside local file paths. An LLM-driven mini agent loop inspects the URL and available MCPX tools, picks the best tool for the job (e.g., Google Docs tools for a Google Docs link, Firecrawl for a generic web page), fetches the content, and feeds it into the existing ingest pipeline. Falls back to plain `fetch()` when no MCP tools are available.

## What Gets Unblocked

- Users can ingest web pages, Google Docs, and other remote content as context
- The agent selects the right fetching tool automatically — no hardcoded URL patterns
- Authenticated resources work when the appropriate MCP server is configured (Google, Notion, etc.)
- A `context refresh` command re-fetches stale remote content without re-adding URLs
- The `source_path` field stores the origin URL, enabling provenance tracking and refresh

---

## Implementation

### 1. URL Utility Functions (`src/context/url-utils.ts`)

A small utility module with no external dependencies.

**`isUrl(input: string): boolean`**
- Attempts `new URL(input)`, returns `true` if protocol is `http:` or `https:`
- Used by the `context add` command to route URLs vs local paths

**`urlToContextPath(url: string, prefix: string): string`**
- Derives a virtual context path from a URL
- Extracts hostname and pathname, slugifies, appends `.md`
- Example: `https://docs.google.com/document/d/abc123/edit` → `/{prefix}/docs.google.com/document-d-abc123.md`
- Truncates if the resulting path exceeds 120 characters

**`stripHtmlTags(html: string): string`**
- Regex-based HTML tag removal for the fallback path
- Strips `<script>`, `<style>` blocks, then all remaining tags
- Collapses whitespace
- No external dependencies

### 2. Agent-Driven URL Fetcher (`src/context/fetcher.ts`)

A mini agent loop following the same pattern as `src/daemon/llm.ts:runAgentLoop`, but scoped to a single task: fetch the content at a URL.

**Interface:**

```typescript
export interface FetchedContent {
  title: string;
  content: string;
  mimeType: string;
  sourceUrl: string;
}

export async function fetchUrl(
  url: string,
  config: Required<BotholomewConfig>,
  mcpxClient: McpxClient | null,
): Promise<FetchedContent>;
```

**System prompt:**

```
You are a content fetcher. Your job is to retrieve the content at the given URL
and return it as clean text or markdown.

You have access to MCP tools that can fetch web content, read Google Docs,
and access other services. Use mcp_list_tools to see what's available,
then pick the best tool for this URL.

Once you have the content, call return_content with the title and content.

If no MCP tools can handle this URL, call return_content with fallback set
to true — the system will attempt a basic HTTP fetch instead.
```

**User message:** `Fetch the content at: {url}`

**Available tools:**
- `mcp_list_tools` — discover available MCP servers/tools
- `mcp_search` — semantic search for relevant tools
- `mcp_info` — get tool input schema before calling
- `mcp_exec` — execute an MCP tool
- `return_content` — terminal tool to return the fetched content (see below)

These are the existing MCP tools from `src/tools/mcp/` plus one new terminal tool. They are registered in a separate scope (not the global tool registry) so they don't leak into the daemon's tool set.

**Agent loop details:**
- Max turns: 5 (this is a focused, single-purpose task)
- Uses the project's `config.model` and `config.anthropic_api_key`
- The `ToolContext` is constructed with the provided `mcpxClient`, `config`, and a temporary in-memory DB connection (the fetcher doesn't need DB access, but the tool context type requires it — pass `null` and guard in tool implementations)
- On max turns exceeded: fall back to plain `fetch()`

**Fallback path (no MCPX or agent can't find a tool):**
- `fetch(url)` with `User-Agent: Botholomew/1.0` and 30-second timeout
- If response `Content-Type` is HTML: run `stripHtmlTags()` from url-utils
- If plaintext or markdown: use as-is
- Title: extract from `<title>` tag or use URL hostname
- If fetch fails (network error, 4xx, 5xx): throw with a clear error message

### 3. `return_content` Terminal Tool

A tool registered only for the fetcher agent loop. It terminates the loop and returns structured content.

```typescript
const inputSchema = z.object({
  title: z.string().describe("Title of the content"),
  content: z.string().describe("The fetched content as text or markdown"),
  mime_type: z.string().describe("MIME type of the content").default("text/markdown"),
  fallback: z.boolean().optional().describe("Set to true if no MCP tool could handle the URL — the system will try a basic HTTP fetch"),
});
```

When `fallback: true`, the fetcher function catches this and runs the plain `fetch()` path instead of using the agent's returned content.

### 4. URL Detection in `context add` (`src/commands/context.ts`)

Modify the `add` action's path loop (currently at line 79). Before calling `stat()` on each path, check `isUrl(path)`:

```typescript
for (const path of paths) {
  if (isUrl(path)) {
    // Route to addUrl()
  } else {
    // Existing local file logic (unchanged)
  }
}
```

**New `addUrl()` function** (parallel to existing `addFile()`):

```typescript
async function addUrl(
  conn: DbConnection,
  config: BotholomewConfig,
  url: string,
  contextPath: string,
  mcpxClient: McpxClient | null,
): Promise<number>
```

Steps:
1. Call `fetchUrl(url, config, mcpxClient)` to get content via the agent loop
2. Check for existing item at `contextPath` — update if exists, create if not
3. Set `source_type: 'url'`, `source_path: url`, `is_textual: true`
4. Call `ingestContextItem()` to run the existing chunk → embed → store pipeline
5. Return chunk count

**MCPX initialization:**
- When any URL arguments are detected, initialize `McpxClient` via `createMcpxClient(projectDir)` (reuse from `src/mcpx/client.ts`)
- If `createMcpxClient` returns `null` (no servers configured), proceed anyway — the fetcher will use the fallback path
- Log a warning: "No MCP servers configured — remote fetches will use basic HTTP"

**New `--name <path>` option** on `context add`:
- Overrides the auto-derived context path for a URL
- Only valid when adding a single URL

### 5. Schema Migration (`src/db/sql/5-source-type.sql`)

```sql
ALTER TABLE context_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'file';
```

Update `src/db/context.ts`:
- Add `source_type: string` to `ContextItemRow` interface
- Add `source_type: 'file' | 'url'` to `ContextItem` interface
- Update `rowToContextItem()` to pass through the value
- Update `createContextItem()` to accept optional `sourceType` parameter (default `'file'`)

Update `src/db/schema.ts`:
- Add the new migration file to the migrations list

### 6. `context refresh` Subcommand (`src/commands/context.ts`)

```
botholomew context refresh [path]
```

- If `path` provided: refresh that single item (must have `source_type = 'url'`)
- If no `path`: refresh all items where `source_type = 'url'`
- For each item:
  1. Call `fetchUrl(item.source_path, config, mcpxClient)`
  2. Compare fetched content to `item.content`
  3. If changed: update content, re-run `ingestContextItem()`
  4. If unchanged: skip
- Report: `Refreshed N item(s), M had changes, K chunks re-indexed`
- Optional `--stale <duration>` flag (e.g., `--stale 7d`): only refresh items where `updated_at < now - duration`

### 7. Display Enhancements (`src/commands/context.ts`)

Update `context list` output to show source type:
- Add a `Source` column showing `file` or `url`
- For URL items, the existing `source_path` display naturally shows the URL

---

## Files Modified

| File | Change |
|------|--------|
| `src/context/fetcher.ts` | **New** — agent-driven URL fetcher with MCPX tool selection and fallback |
| `src/context/url-utils.ts` | **New** — `isUrl()`, `urlToContextPath()`, `stripHtmlTags()` |
| `src/commands/context.ts` | URL detection in `add`, `addUrl()`, MCPX init, `refresh` subcommand, `--name` flag, list display |
| `src/db/sql/5-source-type.sql` | **New** — migration adding `source_type` column |
| `src/db/context.ts` | Add `source_type` to `ContextItemRow`, `ContextItem`, `rowToContextItem()`, `createContextItem()` |
| `src/db/schema.ts` | Add migration 5 to the migrations list |

## Tests

- `test/context/url-utils.test.ts` — `isUrl()` with HTTP/HTTPS/file/relative paths; `urlToContextPath()` derivation and truncation; `stripHtmlTags()` with script/style/nested tags
- `test/context/fetcher.test.ts` — mock Anthropic client + MCPX client; verify agent selects appropriate tools; verify fallback path when no MCPX; verify `return_content` terminal behavior; verify max-turns fallback
- `test/commands/context-add-url.test.ts` — adding a URL creates item with `source_type='url'` and correct `source_path`; adding same URL twice updates rather than duplicates; `refresh` re-fetches and re-ingests when content changes; `refresh` is a no-op when content unchanged; `--name` override works

## Verification

1. `bun run lint` and `bun test` pass
2. `bun run dev -- context add https://docs.google.com/document/d/{public-doc-id}` — agent finds Google Docs tools, ingests content
3. `bun run dev -- context add https://example.com` — agent picks best available tool or falls back to `fetch()`
4. `bun run dev -- context add https://example.com --name /articles/example.md` — stores at custom path
5. `bun run dev -- context list` — shows `url` source type and the origin URL
6. `bun run dev -- context refresh` — re-fetches URL items, reports changes
7. `bun run dev -- context search "term from remote content"` — returns results from ingested URL
