import { ErrorType, TypedError } from "keryx";
import type { Tag } from "../schema/tags";

/** The reserved tag name that confers administrative rights on a project. */
export const ADMIN_TAG = "admin";

/**
 * Every tag name the tag actions refuse to touch. Reserved names are created
 * only by the signup bootstrap (`createProjectForOwner`), because granting one
 * changes what a member may do. Adding a reserved name here is all it takes for
 * `tag:create` / `tag:edit` / `tag:delete` to start refusing it.
 */
export const RESERVED_TAGS: readonly string[] = [ADMIN_TAG];

/**
 * Normalize a tag name for comparison: trimmed and lowercased. Every tag
 * comparison in the app goes through this, so `" Admin "` can never sneak past a
 * check that `"admin"` would fail.
 * @param name - The raw tag name.
 * @returns The normalized name.
 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Whether a tag name is reserved.
 * @param name - The tag name to test.
 * @returns `true` if the name is one of {@link RESERVED_TAGS}.
 */
export function isReservedTag(name: string): boolean {
  return RESERVED_TAGS.includes(normalizeTagName(name));
}

/**
 * Shape a tag row into the API-safe object returned by actions. Timestamps are
 * emitted as epoch milliseconds.
 *
 * `reserved` is computed here rather than left for the client to infer by
 * comparing the name to `"admin"`. Reserved-ness is a backend rule, and a client
 * that hardcoded the name would quietly disagree the moment {@link RESERVED_TAGS}
 * grows — and the frontend cannot import this constant anyway, since a value
 * import from the backend would pull the whole framework into the browser bundle.
 * @param tag - The tag row from the database.
 * @returns The serialized tag.
 */
export function serializeTag(tag: Tag) {
  return {
    id: tag.id,
    projectId: tag.projectId,
    name: tag.name,
    reserved: isReservedTag(tag.name),
    createdAt: tag.createdAt.getTime(),
    updatedAt: tag.updatedAt.getTime(),
  };
}

/**
 * Guard that rejects any attempt to create, rename, or delete a reserved tag.
 * @param name - The tag name being created, renamed, or deleted.
 * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` if the name is reserved.
 */
export function assertNotReservedTag(name: string): void {
  if (isReservedTag(name)) {
    throw new TypedError({
      message: `The "${normalizeTagName(name)}" tag is reserved and cannot be created, renamed, or deleted`,
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      key: "name",
    });
  }
}
