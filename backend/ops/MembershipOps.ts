import { and, eq } from "drizzle-orm";
import { api } from "keryx";
import type { ProjectMembership } from "../schema/project_memberships";
import { type Tag, tags } from "../schema/tags";
import { userTags } from "../schema/user_tags";
import type { TxHandle } from "./ProjectOps";
import { ADMIN_TAG } from "./TagOps";

/**
 * Shape a membership row into the API-safe object returned by actions.
 * Timestamps are emitted as epoch milliseconds.
 * @param membership - The membership row from the database.
 * @returns The serialized membership.
 */
export function serializeMembership(membership: ProjectMembership) {
  return {
    id: membership.id,
    userId: membership.userId,
    projectId: membership.projectId,
    createdAt: membership.createdAt.getTime(),
    updatedAt: membership.updatedAt.getTime(),
  };
}

/**
 * Load the tags a user holds within a specific project. Joins `user_tags` to
 * `tags` and filters by project, so only that project's tags come back — tags
 * are project-scoped, and a user's `admin` tag in one project must not
 * administer another.
 * @param userId - The user whose tags to load.
 * @param projectId - The project to scope the tags to.
 * @returns The user's tags for that project (empty if none).
 */
export async function getCallerTags(
  userId: number,
  projectId: number,
): Promise<Tag[]> {
  const rows = await api.db.db
    .select({ tag: tags })
    .from(userTags)
    .innerJoin(tags, eq(userTags.tagId, tags.id))
    .where(and(eq(userTags.userId, userId), eq(tags.projectId, projectId)));

  return rows.map((r) => r.tag);
}

/**
 * Whether a set of tags contains one with the given name. Matching is trimmed
 * and lowercased on both sides.
 * @param tagList - The tags to search.
 * @param name - The tag name to look for.
 * @returns `true` if a matching tag is present.
 */
export function hasTag(tagList: Tag[], name: string): boolean {
  const target = name.trim().toLowerCase();
  return tagList.some((t) => t.name.trim().toLowerCase() === target);
}

/**
 * Whether a set of tags includes the reserved `admin` tag.
 * @param tagList - The tags to check.
 * @returns `true` if the caller is an admin of the project those tags came from.
 */
export function isAdmin(tagList: Tag[]): boolean {
  return hasTag(tagList, ADMIN_TAG);
}

/**
 * List the ids of every user holding the reserved `admin` tag in a project. This
 * backs the last-admin guard, so it accepts a transaction handle: the guard must
 * read the admin set inside the same transaction as the delete it protects,
 * otherwise two concurrent removals could each see two admins.
 * @param db - A Drizzle transaction handle, or the shared `api.db.db`.
 * @param projectId - The project whose admins to list.
 * @returns The user ids holding the `admin` tag (empty if the project has none).
 */
export async function getAdminUserIds(
  db: TxHandle | typeof api.db.db,
  projectId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: userTags.userId })
    .from(userTags)
    .innerJoin(tags, eq(userTags.tagId, tags.id))
    .where(and(eq(tags.projectId, projectId), eq(tags.name, ADMIN_TAG)));

  return rows.map((r) => r.userId);
}
