/**
 * Temporary in-memory store for large tool results.
 *
 * When a tool result exceeds MAX_INLINE_CHARS, it is stored here and replaced
 * with a summary stub. The LLM can then paginate through the full result
 * using the `read_large_result` tool.
 */

/** Maximum characters to inline directly in the conversation */
export const MAX_INLINE_CHARS = 10_000;

/** Characters per page when paginating */
export const PAGE_SIZE_CHARS = 8_000;

interface StoredResult {
  toolName: string;
  content: string;
  totalChars: number;
  totalPages: number;
  createdAt: number;
}

const store = new Map<string, StoredResult>();
let nextId = 1;

/** Store a large result and return its reference ID */
export function storeLargeResult(toolName: string, content: string): string {
  const id = `lr_${nextId++}`;
  const totalPages = Math.ceil(content.length / PAGE_SIZE_CHARS);
  store.set(id, {
    toolName,
    content,
    totalChars: content.length,
    totalPages,
    createdAt: Date.now(),
  });
  return id;
}

/** Read a page from a stored result (1-based page number) */
export function readLargeResultPage(
  id: string,
  page: number,
): { content: string; page: number; totalPages: number } | null {
  const entry = store.get(id);
  if (!entry) return null;

  const start = (page - 1) * PAGE_SIZE_CHARS;
  if (start >= entry.content.length) return null;

  const content = entry.content.slice(start, start + PAGE_SIZE_CHARS);
  return { content, page, totalPages: entry.totalPages };
}

/** Build the inline stub that replaces the full result in the conversation */
export function buildResultStub(
  id: string,
  toolName: string,
  content: string,
): string {
  const totalPages = Math.ceil(content.length / PAGE_SIZE_CHARS);
  const preview = content.slice(0, 500);
  return [
    `[Large result from ${toolName} stored as ${id} — ${content.length} chars, ${totalPages} page(s)]`,
    "",
    "Preview:",
    preview,
    preview.length < content.length ? "..." : "",
    "",
    `Use read_large_result with id="${id}" to read page-by-page (pages 1–${totalPages}).`,
  ].join("\n");
}

export interface MaybeStoreResultOutput {
  text: string;
  stored?: { id: string; chars: number; pages: number };
}

/**
 * If the tool output exceeds MAX_INLINE_CHARS, store it and return a stub.
 * Otherwise return the original output unchanged.
 */
export function maybeStoreResult(
  toolName: string,
  output: string,
): MaybeStoreResultOutput {
  if (output.length <= MAX_INLINE_CHARS) return { text: output };

  const id = storeLargeResult(toolName, output);
  const pages = Math.ceil(output.length / PAGE_SIZE_CHARS);
  return {
    text: buildResultStub(id, toolName, output),
    stored: { id, chars: output.length, pages },
  };
}

/** Clear all stored results (useful between agent loop runs or for cleanup) */
export function clearLargeResults(): void {
  store.clear();
}
