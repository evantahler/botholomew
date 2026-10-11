import { and, eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { getAdminUserIds } from "../../ops/MembershipOps";
import { ADMIN_TAG, serializeTag } from "../../ops/TagOps";
import { tags } from "../../schema/tags";
import { userTags } from "../../schema/user_tags";

/**
 * `user-tag:remove` — revoke a project tag from a member. Requires the admin tag.
 * Idempotent: revoking a tag the user does not hold is a no-op success.
 *
 * Revoking `admin` from the project's **last admin** is refused. That is the same
 * orphaned-project failure `membership:delete` guards, reached by the other door:
 * the member would stay, but nobody could administer the project. The guard reads
 * the admin set inside the transaction that performs the delete.
 */
export class UserTagRemove extends AuditedAction {
  name = "user-tag:remove";
  description =
    "Revoke a project tag from a member. Requires the admin tag on the project. The admin tag cannot be revoked from the project's last admin.";
  middleware = [AdminMiddleware()];
  web = { route: "/user-tag", method: HTTP_METHOD.DELETE };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project the tag belongs to (this authorizes the caller)"),
    userId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The member to revoke the tag from"),
    tagId: z.coerce.number().int().positive().describe("The tag to revoke"),
  });

  /**
   * @param tx - The transaction the last-admin read, the delete, and the audit row share.
   * @param params - The validated inputs (`projectId`, `userId`, `tagId`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns `{ success: true }` on completion.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if the tag is not in this
   *   project; `CONNECTION_ACTION_PARAM_VALIDATION` when this would remove the last admin.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<UserTagRemove>,
    connection: AuditedConnection,
  ) {
    // Scope the tag to the project the caller is authorized for, so an admin of
    // one project cannot revoke tags belonging to another.
    const [tag] = await tx
      .select()
      .from(tags)
      .where(
        and(eq(tags.id, params.tagId), eq(tags.projectId, params.projectId)),
      )
      .limit(1);
    if (!tag) {
      throw new TypedError({
        message: "Tag not found in this project",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }

    if (tag.name.trim().toLowerCase() === ADMIN_TAG) {
      const admins = await getAdminUserIds(tx, params.projectId);
      if (admins.length === 1 && admins.includes(params.userId)) {
        throw new TypedError({
          message:
            "Cannot revoke the admin tag from the last admin of a project. Promote another member to admin first.",
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
          key: "userId",
        });
      }
    }

    const [existing] = await tx
      .select()
      .from(userTags)
      .where(
        and(
          eq(userTags.userId, params.userId),
          eq(userTags.tagId, params.tagId),
        ),
      )
      .limit(1);

    // Null `before` on the idempotent path records what actually happened: a
    // revocation of something the member did not hold.
    connection.metadata.auditBefore = existing
      ? { id: existing.id, userId: existing.userId, tagId: existing.tagId }
      : null;
    connection.metadata.auditTargetType = "user-tag";
    connection.metadata.auditTargetPath = tag.name;
    connection.metadata.auditMetadata = {
      projectId: params.projectId,
      userId: params.userId,
      tagId: params.tagId,
      tag: serializeTag(tag),
    };

    await tx
      .delete(userTags)
      .where(
        and(
          eq(userTags.userId, params.userId),
          eq(userTags.tagId, params.tagId),
        ),
      );

    return { success: true };
  }
}
