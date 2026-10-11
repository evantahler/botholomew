import { asc, count, eq } from "drizzle-orm";
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
import { serializeTag } from "../../ops/TagOps";
import { tags } from "../../schema/tags";

/**
 * `tag:list` — the permission tags defined in a project, alphabetically. Requires
 * membership: every member needs to see the tag vocabulary, only admins may
 * change it.
 */
export class TagList implements Action {
  name = "tag:list";
  description =
    "List the permission tags defined in a project, ordered by name. Requires membership in the project. Paginated.";
  middleware = [ProjectMemberMiddleware()];
  web = { route: "/tags", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 }).extend({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project whose tags to list"),
  });

  /**
   * @param params - `projectId` plus pagination inputs.
   * @returns The project's tags plus pagination metadata.
   */
  async run(params: ActionParams<TagList>) {
    const where = eq(tags.projectId, params.projectId);

    const result = await paginate(
      api.db.db
        .select()
        .from(tags)
        .where(where)
        .orderBy(asc(tags.name))
        .$dynamic(),
      api.db.db.select({ count: count() }).from(tags).where(where),
      params,
    );

    return {
      tags: result.data.map(serializeTag),
      pagination: result.pagination,
    };
  }
}
