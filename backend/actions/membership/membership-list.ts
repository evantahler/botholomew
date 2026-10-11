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
import { ProjectMemberMiddleware } from "../../middleware/rbac";
import { getCallerTags, serializeMembership } from "../../ops/MembershipOps";
import { serializeTag } from "../../ops/TagOps";
import { serializeUser } from "../../ops/UserOps";
import { projectMemberships } from "../../schema/project_memberships";
import { users } from "../../schema/users";

/**
 * `membership:list` — a project's members, each with their profile and the tags
 * they hold in that project. Emails are included because members of a project are
 * peers; this is the roster an admin manages tags from. Requires membership.
 */
export class MembershipList implements Action {
  name = "membership:list";
  description =
    "List the members of a project, each with their user profile and the tags they hold in the project. Requires membership in the project. Paginated.";
  middleware = [ProjectMemberMiddleware()];
  web = { route: "/memberships", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 }).extend({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project whose members to list"),
  });

  /**
   * @param params - `projectId` plus pagination inputs.
   * @returns The members (with user and tags) plus pagination metadata.
   */
  async run(params: ActionParams<MembershipList>) {
    const where = eq(projectMemberships.projectId, params.projectId);

    const result = await paginate(
      api.db.db
        .select({ membership: projectMemberships, user: users })
        .from(projectMemberships)
        .innerJoin(users, eq(projectMemberships.userId, users.id))
        .where(where)
        .orderBy(desc(projectMemberships.createdAt))
        .$dynamic(),
      api.db.db
        .select({ count: count() })
        .from(projectMemberships)
        .where(where),
      params,
    );

    const memberships = await Promise.all(
      result.data.map(async (row) => ({
        ...serializeMembership(row.membership),
        user: serializeUser(row.user),
        tags: (await getCallerTags(row.user.id, params.projectId)).map(
          serializeTag,
        ),
      })),
    );

    return { memberships, pagination: result.pagination };
  }
}
