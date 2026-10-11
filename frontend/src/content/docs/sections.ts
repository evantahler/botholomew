import cli from "./cli.md?raw";
import gettingStarted from "./getting-started.md?raw";
import mcp from "./mcp.md?raw";
import overview from "./overview.md?raw";
import security from "./security.md?raw";
import teams from "./teams.md?raw";

/** Which heading a docs page sits under in the sidebar. */
export type DocsGroup = "About" | "Use" | "Operate";

/** One entry in the public docs sidebar. */
export interface DocsSection {
  /** The URL segment: `/docs/<slug>`. */
  slug: string;
  /** What the sidebar calls it. */
  label: string;
  /** The heading it sits under. */
  group: DocsGroup;
  /** Markdown source for the page. */
  source: string;
}

/**
 * The public docs sidebar, in order.
 *
 * Content lives in sibling `.md` files and is bundled via Vite's `?raw` import
 * (Bun's test runner understands the same suffix). The pages are rendered
 * through {@link MarkdownBlock} into the terminal theme — there is no separate
 * docs chrome palette, and there is deliberately no `rehype-raw`.
 *
 * Keep this table and the markdown files in the same commit when a feature
 * ships or a user-facing behavior changes; see AGENTS.md.
 */
export const DOCS_SECTIONS: readonly DocsSection[] = [
  { slug: "overview", label: "Overview", group: "About", source: overview },
  {
    slug: "getting-started",
    label: "Getting started",
    group: "About",
    source: gettingStarted,
  },
  { slug: "teams", label: "Teams & audit", group: "Use", source: teams },
  { slug: "cli", label: "CLI", group: "Use", source: cli },
  { slug: "mcp", label: "MCP", group: "Use", source: mcp },
  { slug: "security", label: "Security", group: "Operate", source: security },
] as const;

/**
 * The page shown when `/docs` names none — and the target of the index route.
 *
 * Overview: a first visit should answer "what is this" first, and the navbar's
 * Docs link lands somewhere a stranger can read without any other page.
 */
export const DEFAULT_DOCS_SECTION = "overview";

/**
 * Look up a docs page by its URL slug.
 * @param slug - The `/docs/<slug>` segment.
 * @returns The section, or `undefined` when the slug is unknown.
 */
export function findDocsSection(slug: string): DocsSection | undefined {
  return DOCS_SECTIONS.find((section) => section.slug === slug);
}
