import matter from "gray-matter";

export interface ContextFileMeta {
  loading?: "always" | "contextual";
  "agent-modification"?: boolean;
  // Set by `botholomew context import <url>` so the saved file remembers
  // where it came from. Optional so files written by other paths
  // (prompts/, beliefs/, agent-authored notes) aren't required to
  // carry import metadata.
  source_url?: string;
  imported_at?: string;
  title?: string;
  [key: string]: unknown;
}

export function parseContextFile(raw: string): {
  meta: ContextFileMeta;
  content: string;
} {
  const { data, content } = matter(raw);
  return {
    meta: data as ContextFileMeta,
    content: content.trim(),
  };
}

export function serializeContextFile(
  meta: ContextFileMeta,
  content: string,
): string {
  return matter.stringify(`\n${content}\n`, meta);
}
