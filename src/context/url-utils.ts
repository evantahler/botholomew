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
