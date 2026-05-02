import { formatDriveRef } from "../../context/drives.ts";
import type { ContextItem } from "../../db/context.ts";

export interface RegexpHit {
  ref: string;
  drive: string;
  path: string;
  line: number;
  content: string;
  context_lines: string[];
}

export interface RegexpOptions {
  pattern: string;
  glob?: string;
  ignore_case?: boolean;
  context?: number;
  max_results?: number;
}

export function runRegexp(
  items: ContextItem[],
  options: RegexpOptions,
): RegexpHit[] {
  const flags = options.ignore_case ? "gi" : "g";
  const regex = new RegExp(options.pattern, flags);
  const globRegex = options.glob ? globToRegex(options.glob) : null;
  const contextLines = options.context ?? 0;
  const maxResults = options.max_results ?? 100;

  const hits: RegexpHit[] = [];

  for (const item of items) {
    if (item.content == null) continue;

    if (globRegex) {
      const filename = item.path.split("/").pop() ?? "";
      if (!globRegex.test(filename)) continue;
    }

    const lines = item.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      const line = lines[i];
      if (line !== undefined && regex.test(line)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        hits.push({
          ref: formatDriveRef(item),
          drive: item.drive,
          path: item.path,
          line: i + 1,
          content: line,
          context_lines: lines.slice(start, end),
        });
        if (hits.length >= maxResults) return hits;
      }
    }
  }

  return hits;
}

export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
