import { and, count, desc, eq, gt } from "drizzle-orm";
import {
  type Action,
  type ActionParams,
  api,
  Connection,
  HTTP_METHOD,
  paginate,
  paginationInputs,
} from "keryx";
import { type SessionImpl, SessionMiddleware } from "../../middleware/session";
import { INVITE_STATUS, serializeInvite } from "../../ops/InviteOps";
import { getUserById } from "../../ops/UserOps";
import { projectInvites } from "../../schema/project_invites";

/**
 * `invite:list-pending` — the pending, non-expired invites addressed to the
 * signed-in user. Keyed on the caller's **email**, not on membership, which is the
 * whole point: a brand-new signup has no memberships yet and must still see the
 * invitation that brought them here.
 */
export class InviteListPending implements Action {
  name = "invite:list-pending";
  description =
    "List the pending, non-expired project invitations addressed to the currently signed-in user's email, so they can be accepted or rejected. Requires an active session. Paginated.";
  middleware = [SessionMiddleware];
  web = { route: "/invites/pending", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 });

  /**
   * @param params - Pagination inputs (`page`, `limit`).
   * @param connection - The caller's connection (session required).
   * @returns The caller's pending invites plus pagination metadata.
   */
  async run(
    params: ActionParams<InviteListPending>,
    connection: Connection<SessionImpl>,
  ) {
    const user = await getUserById(connection.session!.data.userId!);
    const email = user?.email ?? "";

    const where = and(
      eq(projectInvites.inviteeEmail, email),
      eq(projectInvites.status, INVITE_STATUS.pending),
      gt(projectInvites.expiresAt, new Date()),
    );

    const result = await paginate(
      api.db.db
        .select()
        .from(projectInvites)
        .where(where)
        .orderBy(desc(projectInvites.createdAt))
        .$dynamic(),
      api.db.db.select({ count: count() }).from(projectInvites).where(where),
      params,
    );

    return {
      invites: result.data.map(serializeInvite),
      pagination: result.pagination,
    };
  }
}
