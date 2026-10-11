import { count, desc, eq } from "drizzle-orm";
import {
  type Action,
  type ActionParams,
  api,
  HTTP_METHOD,
  paginate,
  paginationInputs,
} from "keryx";
import { z } from "zod";
import { AdminMiddleware } from "../../middleware/rbac";
import { serializeInvite } from "../../ops/InviteOps";
import { projectInvites } from "../../schema/project_invites";

/**
 * `invite:list` — the admin view of a project's invites in every status, newest
 * first. Requires the admin tag: it lists email addresses of people who are not
 * (yet) members.
 */
export class InviteList implements Action {
  name = "invite:list";
  description =
    "List all invitations for a project in any status (pending, accepted, rejected), newest first. Requires the admin tag on the project. Paginated.";
  middleware = [AdminMiddleware()];
  web = { route: "/invites", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 }).extend({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project whose invites to list"),
  });

  /**
   * @param params - `projectId` plus pagination inputs.
   * @returns The project's invites plus pagination metadata.
   */
  async run(params: ActionParams<InviteList>) {
    const where = eq(projectInvites.projectId, params.projectId);

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
