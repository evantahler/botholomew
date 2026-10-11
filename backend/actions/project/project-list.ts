import { count, desc, eq } from "drizzle-orm";
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
import { serializeProject } from "../../ops/ProjectOps";
import { projectMemberships } from "../../schema/project_memberships";
import { projects } from "../../schema/projects";

/**
 * `project:list` — the projects the caller belongs to, newest first. This is not
 * project-scoped RBAC: the caller's own memberships *are* the filter, so it needs
 * only a session. Backs the navbar's project switcher.
 */
export class ProjectList implements Action {
  name = "project:list";
  description =
    "List the projects the currently signed-in user is a member of, newest first. Requires an active session. Paginated.";
  middleware = [SessionMiddleware];
  web = { route: "/projects", method: HTTP_METHOD.GET };
  inputs = paginationInputs({ defaultLimit: 25 });

  /**
   * @param params - Pagination inputs (`page`, `limit`).
   * @param connection - The caller's connection (session required).
   * @returns The caller's projects plus pagination metadata.
   */
  async run(
    params: ActionParams<ProjectList>,
    connection: Connection<SessionImpl>,
  ) {
    const userId = connection.session!.data.userId!;
    const where = eq(projectMemberships.userId, userId);

    const result = await paginate(
      api.db.db
        .select({ project: projects })
        .from(projectMemberships)
        .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
        .where(where)
        .orderBy(desc(projects.createdAt))
        .$dynamic(),
      api.db.db
        .select({ count: count() })
        .from(projectMemberships)
        .where(where),
      params,
    );

    return {
      projects: result.data.map((r) => serializeProject(r.project)),
      pagination: result.pagination,
    };
  }
}
