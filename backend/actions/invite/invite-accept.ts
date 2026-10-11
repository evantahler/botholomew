import { and, eq } from "drizzle-orm";
import {
  type ActionParams,
  ErrorType,
  HTTP_METHOD,
  RateLimitMiddleware,
  TypedError,
} from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { SessionMiddleware } from "../../middleware/session";
import { INVITE_STATUS, isExpired, serializeInvite } from "../../ops/InviteOps";
import { serializeMembership } from "../../ops/MembershipOps";
import { getUserById } from "../../ops/UserOps";
import { projectInvites } from "../../schema/project_invites";
import { projectMemberships } from "../../schema/project_memberships";
import { tags } from "../../schema/tags";
import { userTags } from "../../schema/user_tags";

/**
 * `invite:accept` — the invitee accepts an invitation addressed to their email:
 * the membership is created and each still-valid tag granted, in one transaction,
 * and the invite is marked accepted.
 *
 * Ownership is proven by **email match**, not by a token in the URL. The invite id
 * is not a secret, and a caller can only act on an invite addressed to the address
 * they signed in with — so there is nothing to leak and nothing to guess.
 *
 * Idempotent on both the membership and the tags: accepting twice, or accepting
 * something already granted through another route, converges rather than erroring.
 * Tags removed from the project since the invite was written are skipped.
 *
 * The audit row is scoped with `auditProjectId` — the project is named on the
 * invite row, not in the params, and a row filed under no project would never
 * reach the audit list of the project that just gained a member.
 */
export class InviteAccept extends AuditedAction {
  name = "invite:accept";
  description =
    "Accept a pending project invitation addressed to your email. Creates your membership and grants the invite's tags, then marks the invite accepted. Requires an active session.";
  middleware = [RateLimitMiddleware, SessionMiddleware];
  web = { route: "/invite/accept", method: HTTP_METHOD.POST };
  inputs = z.object({
    inviteId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the invite to accept"),
  });

  /**
   * @param tx - The transaction the membership, the tag grants, and the audit row share.
   * @param params - The validated inputs (`inviteId`).
   * @param connection - The invitee's connection (session required).
   * @returns The invitee's membership and the accepted invite.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if no invite with that id is
   *   addressed to the caller; `CONNECTION_ACTION_PARAM_VALIDATION` if it is expired or already
   *   answered.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<InviteAccept>,
    connection: AuditedConnection,
  ) {
    const user = await getUserById(connection.session!.data.userId!, tx);

    const [invite] = await tx
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.id, params.inviteId))
      .limit(1);

    // Same error for "no such invite" and "not yours", so invite ids cannot be
    // probed for which projects exist.
    if (!invite || invite.inviteeEmail !== user?.email) {
      throw new TypedError({
        message: "Invite not found",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }
    if (invite.status !== INVITE_STATUS.pending || isExpired(invite)) {
      throw new TypedError({
        message: "This invite is no longer valid",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "inviteId",
      });
    }

    const userId = user.id;

    const [existing] = await tx
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.userId, userId),
          eq(projectMemberships.projectId, invite.projectId),
        ),
      )
      .limit(1);

    const membership =
      existing ??
      (
        await tx
          .insert(projectMemberships)
          .values({ userId, projectId: invite.projectId })
          .returning()
      )[0];

    const grantedTagIds: number[] = [];
    for (const tagId of invite.tagIds) {
      // Only grant tags that still belong to this project — a tag can be
      // deleted, or its id reused by another project, between invite and accept.
      const [tag] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, tagId), eq(tags.projectId, invite.projectId)))
        .limit(1);
      if (!tag) continue;

      const [alreadyAssigned] = await tx
        .select({ id: userTags.id })
        .from(userTags)
        .where(and(eq(userTags.userId, userId), eq(userTags.tagId, tagId)))
        .limit(1);
      if (alreadyAssigned) continue;

      await tx.insert(userTags).values({ userId, tagId });
      grantedTagIds.push(tagId);
    }

    await tx
      .update(projectInvites)
      .set({ status: INVITE_STATUS.accepted })
      .where(eq(projectInvites.id, invite.id));

    const acceptedInvite = serializeInvite({
      ...invite,
      status: INVITE_STATUS.accepted,
    });

    connection.metadata.auditProjectId = invite.projectId;
    connection.metadata.auditBefore = serializeInvite(invite);
    connection.metadata.auditAfter = acceptedInvite;
    connection.metadata.auditTargetType = "invite";
    connection.metadata.auditTargetPath = invite.inviteeEmail;
    // Which tags were *actually* granted is not derivable from the invite: some
    // may have been deleted, and some the member may already have held.
    connection.metadata.auditMetadata = {
      inviteId: params.inviteId,
      projectId: invite.projectId,
      grantedTagIds,
      membershipAlreadyExisted: !!existing,
    };

    return {
      membership: serializeMembership(membership),
      invite: acceptedInvite,
    };
  }
}
