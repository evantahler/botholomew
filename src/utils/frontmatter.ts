import matter from "gray-matter";
import { z } from "zod";

// --------------------------------------------------------------------------
// Loose context-file metadata
//
// Used for files under `context/` (URL imports, agent-authored notes) and the
// auto-generated `prompts/capabilities.md`. Frontmatter is permissive here:
// imported pages may carry source_url / imported_at; agent notes may have
// nothing at all.
// --------------------------------------------------------------------------

export interface ContextFileMeta {
  loading?: "always" | "contextual";
  "agent-modification"?: boolean;
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

// --------------------------------------------------------------------------
// Strict prompt-file schema
//
// Every file under `prompts/*.md` must conform. Validation runs at load time
// (worker + chat) and on every CRUD operation; failures throw
// PromptValidationError with the offending path so the user can fix it.
// --------------------------------------------------------------------------

export const PromptFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    loading: z.enum(["always", "contextual"]),
    "agent-modification": z.boolean(),
  })
  .strict();

export type PromptFrontmatter = z.infer<typeof PromptFrontmatterSchema>;

export class PromptValidationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "PromptValidationError";
  }
}

export function parsePromptFile(
  path: string,
  raw: string,
): { meta: PromptFrontmatter; content: string } {
  let parsed: { data: Record<string, unknown>; content: string };
  try {
    const m = matter(raw);
    parsed = {
      data: (m.data ?? {}) as Record<string, unknown>,
      content: m.content,
    };
  } catch (err) {
    throw new PromptValidationError(
      path,
      `invalid YAML frontmatter — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new PromptValidationError(
      path,
      "missing frontmatter (required: title, loading, agent-modification)",
    );
  }

  const result = PromptFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new PromptValidationError(path, formatZodIssues(result.error.issues));
  }

  return { meta: result.data, content: parsed.content.trim() };
}

export function serializePromptFile(
  meta: PromptFrontmatter,
  content: string,
): string {
  return matter.stringify(`\n${content}\n`, meta);
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      if (issue.code === "unrecognized_keys") {
        const keys = (issue as z.ZodIssue & { keys?: string[] }).keys ?? [];
        return `unrecognized frontmatter key(s): ${keys.join(", ")}`;
      }
      const field = issue.path.join(".");
      return field
        ? `frontmatter field '${field}': ${issue.message}`
        : issue.message;
    })
    .join("; ");
}
