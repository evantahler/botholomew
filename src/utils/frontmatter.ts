import matter from "gray-matter";

export interface ContextFileMeta {
  loading: "always" | "contextual";
  "agent-modification": boolean;
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
  return matter.stringify("\n" + content + "\n", meta);
}
