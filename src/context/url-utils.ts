/**
 * Attempts to parse the input as a URL and returns true if the protocol is http or https.
 */
export function isUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Derives a virtual context path from a URL.
 * Example: `https://docs.google.com/document/d/abc123/edit` → `/{prefix}/docs.google.com/document-d-abc123.md`
 */
export function urlToContextPath(url: string, prefix: string): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const pathname = parsed.pathname
    .replace(/\/+$/, "") // strip trailing slashes
    .replace(/^\/+/, "") // strip leading slashes
    .replace(/[^a-zA-Z0-9\-_.]/g, "-") // slugify
    .replace(/-{2,}/g, "-"); // collapse repeated dashes

  const slug = pathname ? `${hostname}/${pathname}` : hostname;
  const full = `${prefix.replace(/\/+$/, "")}/${slug}.md`;

  if (full.length > 120) {
    return `${full.slice(0, 117 - 3)}.md`;
  }

  return full;
}

/**
 * Strips HTML tags from a string, removing script/style blocks first,
 * then all remaining tags, and collapsing whitespace.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "") // remove script blocks
    .replace(/<style[\s\S]*?<\/style>/gi, "") // remove style blocks
    .replace(/<[^>]*>/g, "") // remove all remaining tags
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n") // collapse excessive newlines
    .trim();
}
