export function renderMarkdown(text: string): string {
  if (!text) return "";
  return Bun.markdown.ansi(text).trimEnd();
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}
