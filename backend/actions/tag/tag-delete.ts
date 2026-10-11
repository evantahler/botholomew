import { and, eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { assertNotReservedTag, serializeTag } from "../../ops/TagOps";
import { tags } from "../../schema/tags";
import { userTags } from "../../schema/user_tags";

/**
 * `tag:delete` — delete a permission tag and every assignment of it. Requires the
 * admin tag; reserved tags cannot be deleted.
 */
export class TagDelete extends AuditedAction {
  name = "tag:delete";
  description =
    "Delete a permission tag from a project, revoking it from everyone who holds it. Requires the admin tag on the project. The reserved 'admin' tag cannot be deleted.";
  middleware = [AdminMiddleware()];
  web = { route: "/tag", method: HTTP_METHOD.DELETE };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project the tag belongs to"),
    tagId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the tag to delete"),
  });

  /**
   * @param tx - The transaction both deletes and the audit row share.
   * @param params - The validated inputs (`projectId`, `tagId`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns `{ success: true }` on completion.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if the tag is not in this
   *   project; `CONNECTION_ACTION_PARAM_VALIDATION` if the tag is reserved.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<TagDelete>,
    connection: AuditedConnection,
  ) {
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
    assertNotReservedTag(tag.name);

    // Count the holders before revoking, since afterwards there is no way to
    // learn how many people this quietly took a permission away from.
    const holders = await tx
      .select({ userId: userTags.userId })
      .from(userTags)
      .where(eq(userTags.tagId, params.tagId));

    connection.metadata.auditBefore = serializeTag(tag);
    connection.metadata.auditTargetType = "tag";
    connection.metadata.auditTargetPath = tag.name;
    connection.metadata.auditMetadata = {
      projectId: params.projectId,
      tagId: params.tagId,
      revokedFromUserIds: holders.map((h) => h.userId),
    };

    // `user_tags.tagId` cascades, but delete assignments explicitly so the
    // revocation is part of this transaction rather than a database side effect.
    await tx.delete(userTags).where(eq(userTags.tagId, params.tagId));
    await tx.delete(tags).where(eq(tags.id, params.tagId));

    return { success: true };
  }
}
