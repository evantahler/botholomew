import { z } from "zod";
import { loadSkills } from "../../skills/loader.ts";
import type { SkillDefinition } from "../../skills/parser.ts";
import type { ToolDefinition } from "../tool.ts";

const inputSchema = z.object({
  query: z
    .string()
    .describe(
      "Search query (matched against name, description, body, and arg metadata)",
    ),
  top_k: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of results to return (default 10)"),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      score: z.number(),
      match_fields: z.array(z.string()),
      snippet: z.string(),
    }),
  ),
  is_error: z.boolean(),
  hint: z.string().optional(),
});

const SNIPPET_RADIUS = 60;

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

function buildSnippet(body: string, term: string): string {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(term);
  if (idx === -1) return body.slice(0, SNIPPET_RADIUS * 2);

  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(body.length, idx + term.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end) + suffix;
}

interface ScoreEntry {
  skill: SkillDefinition;
  score: number;
  matchFields: Set<string>;
  firstBodyTerm: string | null;
}

function scoreSkill(skill: SkillDefinition, terms: string[]): ScoreEntry {
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  const body = skill.body.toLowerCase();
  const matchFields = new Set<string>();
  let score = 0;
  let firstBodyTerm: string | null = null;

  for (const term of terms) {
    if (term === "") continue;
    if (name.includes(term)) {
      score += 10;
      matchFields.add("name");
    }
    if (desc.includes(term)) {
      score += 5;
      matchFields.add("description");
    }
    for (const arg of skill.arguments) {
      if (arg.name.toLowerCase().includes(term)) {
        score += 3;
        matchFields.add("argument_name");
      }
      if (arg.description.toLowerCase().includes(term)) {
        score += 2;
        matchFields.add("argument_description");
      }
    }
    const bodyHits = Math.min(countOccurrences(body, term), 5);
    if (bodyHits > 0) {
      score += bodyHits;
      matchFields.add("body");
      if (firstBodyTerm === null) firstBodyTerm = term;
    }
  }

  return { skill, score, matchFields, firstBodyTerm };
}

export const skillSearchTool = {
  name: "skill_search",
  description:
    "Keyword search over skills (user-defined slash commands). Matches against name, description, body, and argument metadata. Returns top-K ranked matches. Use skill_read after finding a match.",
  group: "skill",
  inputSchema,
  outputSchema,
  execute: async (input, ctx) => {
    const skills = await loadSkills(ctx.projectDir);
    const terms = input.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (skills.size === 0) {
      return {
        results: [],
        is_error: false,
        hint: "No skills exist yet. Use skill_write to create one.",
      };
    }

    if (terms.length === 0) {
      return {
        results: [],
        is_error: false,
        hint: "Empty query. Provide one or more keywords, or use skill_list to browse.",
      };
    }

    const scored = [...skills.values()].map((s) => scoreSkill(s, terms));
    const matched = scored
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.top_k ?? 10);

    if (matched.length === 0) {
      return {
        results: [],
        is_error: false,
        hint: "No matches. Try broader terms, or use skill_list to browse.",
      };
    }

    const fallbackTerm = terms[0] ?? "";
    return {
      results: matched.map((e) => {
        const snippetTerm = e.firstBodyTerm ?? fallbackTerm;
        return {
          name: e.skill.name,
          description: e.skill.description,
          score: e.score,
          match_fields: [...e.matchFields].sort(),
          snippet: buildSnippet(e.skill.body, snippetTerm),
        };
      }),
      is_error: false,
    };
  },
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
