import { eq } from "drizzle-orm";
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
import { INVITE_STATUS, serializeInvite } from "../../ops/InviteOps";
import { getUserById } from "../../ops/UserOps";
import { projectInvites } from "../../schema/project_invites";

/**
 * `invite:reject` — the invitee declines an invitation addressed to their email.
 * Ownership is proven by email match, exactly as in `invite:accept`. No membership
 * is created; the row is kept (marked `rejected`) so an admin's `invite:list` can
 * show what happened, until `invites:sweep` collects it after expiry.
 *
 * Audited to the invite's project, like `invite:accept` — the admin who sent it is
 * the person the record is for.
 */
export class InviteReject extends AuditedAction {
  name = "invite:reject";
  description =
    "Reject a pending project invitation addressed to your email. Marks the invite rejected without creating a membership. Requires an active session.";
  middleware = [RateLimitMiddleware, SessionMiddleware];
  web = { route: "/invite/reject", method: HTTP_METHOD.POST };
  inputs = z.object({
    inviteId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the invite to reject"),
  });

  /**
   * @param tx - The transaction the update and its audit row share.
   * @param params - The validated inputs (`inviteId`).
   * @param connection - The invitee's connection (session required).
   * @returns The rejected invite.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if no invite with that id is
   *   addressed to the caller.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<InviteReject>,
    connection: AuditedConnection,
  ) {
    const user = await getUserById(connection.session!.data.userId!, tx);

    const [invite] = await tx
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.id, params.inviteId))
      .limit(1);

    if (!invite || invite.inviteeEmail !== user?.email) {
      throw new TypedError({
        message: "Invite not found",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }

    await tx
      .update(projectInvites)
      .set({ status: INVITE_STATUS.rejected })
      .where(eq(projectInvites.id, invite.id));

    const rejected = serializeInvite({
      ...invite,
      status: INVITE_STATUS.rejected,
    });

    connection.metadata.auditProjectId = invite.projectId;
    connection.metadata.auditBefore = serializeInvite(invite);
    connection.metadata.auditAfter = rejected;
    connection.metadata.auditTargetType = "invite";
    connection.metadata.auditTargetPath = invite.inviteeEmail;

    return { invite: rejected };
  }
}
