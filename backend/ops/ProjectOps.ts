import { api } from "keryx";
import { projectMemberships } from "../schema/project_memberships";
import { type Project, projects } from "../schema/projects";
import { tags } from "../schema/tags";
import { userTags } from "../schema/user_tags";
import { ADMIN_TAG } from "./TagOps";

/**
 * The Drizzle transaction handle passed to `api.db.db.transaction(fn)`. Ops that
 * take one can be composed inside a caller's transaction, which is how the
 * signup bootstrap keeps four inserts atomic — and how `AuditedAction` commits
 * the audit row with the change it describes.
 */
export type TxHandle = Parameters<
  Parameters<typeof api.db.db.transaction>[0]
>[0];

/**
 * Convert a project name into a URL-friendly slug: lowercased, non-alphanumeric
 * runs collapsed to single hyphens, and leading/trailing hyphens trimmed.
 * @param name - The human-readable project name.
 * @returns A slug such as `"Evan's Bots"` → `"evan-s-bots"`.
 */
export function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/**
 * Create a project owned by a user: the project, the owner's membership, the
 * reserved `admin` tag, and the user-tag linking them. Must run inside a
 * transaction — it is used by both the signup bootstrap and `project:create`,
 * and a partial bootstrap would leave a project nobody can administer.
 * @param tx - An open Drizzle transaction.
 * @param userId - The owner's user id.
 * @param projectName - The display name for the project.
 * @returns The created project, the owner's membership, and the admin tag.
 */
export async function createProjectForOwner(
  tx: TxHandle,
  userId: number,
  projectName: string,
) {
  const [project] = await tx
    .insert(projects)
    .values({ name: projectName, slug: generateSlug(projectName) })
    .returning();

  const [membership] = await tx
    .insert(projectMemberships)
    .values({ userId, projectId: project.id })
    .returning();

  const [adminTag] = await tx
    .insert(tags)
    .values({ projectId: project.id, name: ADMIN_TAG })
    .returning();

  await tx.insert(userTags).values({ userId, tagId: adminTag.id });

  return { project, membership, adminTag };
}

/**
 * Shape a project row into the API-safe object returned by actions. Timestamps
 * are emitted as epoch milliseconds.
 * @param project - The project row from the database.
 * @returns The serialized project.
 */
export function serializeProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
  };
}
