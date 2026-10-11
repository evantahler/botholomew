import { and, eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { serializeTag } from "../../ops/TagOps";
import { projectMemberships } from "../../schema/project_memberships";
import { tags } from "../../schema/tags";
import { userTags } from "../../schema/user_tags";

/**
 * `user-tag:assign` — grant a project tag to a member. Requires the admin tag.
 * The tag must belong to the project the caller is authorized for and the target
 * must already be a member, so an admin of one project cannot reach into another.
 * Idempotent: re-granting a held tag is a no-op success.
 */
export class UserTagAssign extends AuditedAction {
  name = "user-tag:assign";
  description =
    "Grant a project tag to a member. Requires the admin tag on the project. The user must already be a member and the tag must belong to the project.";
  middleware = [AdminMiddleware()];
  web = { route: "/user-tag", method: HTTP_METHOD.PUT };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project the tag belongs to"),
    userId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The member to grant the tag to"),
    tagId: z.coerce.number().int().positive().describe("The tag to grant"),
  });

  /**
   * @param tx - The transaction the grant and its audit row share.
   * @param params - The validated inputs (`projectId`, `userId`, `tagId`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns The user-tag assignment.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if the tag is not in this
   *   project; `CONNECTION_ACTION_PARAM_VALIDATION` if the user is not a member.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<UserTagAssign>,
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

    const [membership] = await tx
      .select({ id: projectMemberships.id })
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.userId, params.userId),
          eq(projectMemberships.projectId, params.projectId),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new TypedError({
        message: "That user is not a member of this project",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "userId",
      });
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

    const userTag =
      existing ??
      (
        await tx
          .insert(userTags)
          .values({ userId: params.userId, tagId: params.tagId })
          .returning()
      )[0];

    const assignment = {
      id: userTag.id,
      userId: userTag.userId,
      tagId: userTag.tagId,
    };

    // On the idempotent path `before` and `after` match, which is exactly the
    // record wanted: someone granted a tag the member already held.
    connection.metadata.auditBefore = existing ? assignment : null;
    connection.metadata.auditAfter = assignment;
    connection.metadata.auditTargetType = "user-tag";
    connection.metadata.auditTargetPath = tag.name;
    connection.metadata.auditMetadata = {
      projectId: params.projectId,
      userId: params.userId,
      tagId: params.tagId,
      tag: serializeTag(tag),
    };

    return { userTag: assignment };
  }
}
