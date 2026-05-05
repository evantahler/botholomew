import { listContextDir, readContextFile } from "../../context/store.ts";

export interface RegexpHit {
  path: string;
  line: number;
  content: string;
  context_lines: string[];
}

export interface RegexpOptions {
  pattern: string;
  /** Optional path under context/ to scope the walk (default: whole tree). */
  scope?: string;
  glob?: string;
  ignore_case?: boolean;
  context?: number;
  max_results?: number;
}

/**
 * Walk every textual file under `context/` (or `context/<scope>/`) and run
 * `pattern` against each line. Cheap because tools opt into reading content
 * only for files whose names match an optional glob.
 */
export async function runRegexp(
  projectDir: string,
  options: RegexpOptions,
): Promise<RegexpHit[]> {
  const flags = options.ignore_case ? "gi" : "g";
  const regex = new RegExp(options.pattern, flags);
  const globRegex = options.glob ? globToRegex(options.glob) : null;
  const contextLines = options.context ?? 0;
  const maxResults = options.max_results ?? 100;

  const entries = await listContextDir(projectDir, options.scope ?? "", {
    recursive: true,
  });

  const hits: RegexpHit[] = [];
  for (const entry of entries) {
    if (entry.is_directory) continue;
    if (!entry.is_textual) continue;
    if (globRegex) {
      const filename = entry.path.split("/").pop() ?? "";
      if (!globRegex.test(filename)) continue;
    }

    let content: string;
    try {
      content = await readContextFile(projectDir, entry.path);
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      const line = lines[i];
      if (line === undefined) continue;
      if (regex.test(line)) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        hits.push({
          path: entry.path,
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
