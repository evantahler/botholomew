import type { ContextItem } from "../db/context.ts";

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return Bun.markdown.ansi(text).trimEnd();
}

export function isMarkdownItem(
  item: Pick<ContextItem, "mime_type" | "source_path" | "context_path">,
): boolean {
  if (item.mime_type === "text/markdown") return true;
  if (item.source_path?.toLowerCase().endsWith(".md")) return true;
  if (item.context_path.toLowerCase().endsWith(".md")) return true;
  return false;
}
