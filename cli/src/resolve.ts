import type { CliContext } from "./context.ts";
import { requireProject } from "./context.ts";
import { sessionRequest } from "./helpers.ts";

/**
 * Resolve `--project` / config / env to a numeric project id.
 *
 * A value that is all digits is used as-is. Anything else is matched against
 * `project:list` slugs.
 * @param ctx - CLI context.
 * @returns The project id.
 */
export async function resolveProjectId(ctx: CliContext): Promise<number> {
  const selector = requireProject(ctx);
  if (/^\d+$/.test(selector)) return Number(selector);

  let page = 1;
  for (;;) {
    const payload = (await sessionRequest(ctx, "GET", "/projects", {
      query: { page, limit: 100 },
    })) as {
      projects: { id: number; slug: string }[];
      pagination: { pages: number };
    };
    const match = payload.projects.find((p) => p.slug === selector);
    if (match) return match.id;
    if (page >= payload.pagination.pages) {
      throw new Error(`No project with slug "${selector}"`);
    }
    page += 1;
  }
}

/**
 * Resolve tag names or numeric ids within a project to tag ids.
 *
 * A selector that is all digits is used as-is. Anything else is matched against
 * `tag:list` names the way the server matches them — trimmed and lowercased —
 * so `--tag Operators` finds the `operators` tag.
 * @param ctx - CLI context.
 * @param projectId - The project the tags belong to.
 * @param selectors - Names or ids.
 * @returns The tag ids, in the order given.
 */
export async function resolveTagIds(
  ctx: CliContext,
  projectId: number,
  selectors: string[],
): Promise<number[]> {
  if (selectors.every((s) => /^\d+$/.test(s))) return selectors.map(Number);

  const byName = new Map<string, number>();
  let page = 1;
  for (;;) {
    const payload = (await sessionRequest(ctx, "GET", "/tags", {
      query: { projectId, page, limit: 100 },
    })) as {
      tags: { id: number; name: string }[];
      pagination: { pages: number };
    };
    for (const tag of payload.tags) byName.set(tag.name, tag.id);
    if (page >= payload.pagination.pages) break;
    page += 1;
  }

  return selectors.map((selector) => {
    if (/^\d+$/.test(selector)) return Number(selector);
    const id = byName.get(selector.trim().toLowerCase());
    if (id === undefined) {
      throw new Error(`No tag named "${selector}" in this project`);
    }
    return id;
  });
}
