import {
  type Action,
  type ActionParams,
  Connection,
  config,
  HTTP_METHOD,
} from "keryx";
import { z } from "zod";
import {
  ProjectMemberMiddleware,
  type RbacConnectionMeta,
} from "../../middleware/rbac";
import type { SessionImpl } from "../../middleware/session";
import { isAdmin } from "../../ops/MembershipOps";
import { serializeProject } from "../../ops/ProjectOps";
import { serializeTag } from "../../ops/TagOps";

/**
 * `project:view` — read a single project the caller belongs to. The project is
 * already loaded and authorized by {@link ProjectMemberMiddleware}, so this action
 * does no querying of its own.
 *
 * It also returns the caller's `standing` in the project. That is deliberately a
 * server answer: "am I an admin here" is decided by the same `isAdmin` the RBAC
 * middleware uses, so a client never has to know that the rule is spelled `admin`.
 *
 * `mcp` is the same bargain applied to an address. The endpoint an external
 * client connects to is `config.server.web.applicationUrl` plus
 * `config.server.mcp.route`, and both are configuration the frontend cannot see:
 * a browser knows the origin it was *served* from, which in a deployment is the
 * frontend's host and not the API's. Deriving it client-side would produce a URL
 * that looks right and connects to nothing. `enabled` rides along for the same
 * reason — whether the surface exists at all is the server's answer, and a page
 * offering a URL to a disabled server is worse than one saying it is off.
 */
export class ProjectView implements Action {
  name = "project:view";
  description =
    "Get a single project by id, along with the tags you hold in it and whether you are one of its admins. Requires membership in the project.";
  middleware = [ProjectMemberMiddleware()];
  web = { route: "/project", method: HTTP_METHOD.GET };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the project to view"),
  });

  /**
   * @param _params - The validated inputs (`projectId`), consumed by the middleware.
   * @param connection - The caller's connection (project and tags set by middleware).
   * @returns The project, the caller's tags in it, their standing, and where an
   *   external MCP client connects.
   */
  async run(
    _params: ActionParams<ProjectView>,
    connection: Connection<SessionImpl, RbacConnectionMeta>,
  ) {
    const callerTags = connection.metadata.callerTags ?? [];

    return {
      project: serializeProject(connection.metadata.project!),
      callerTags: callerTags.map(serializeTag),
      standing: {
        // Reaching this action at all proves membership — the middleware refused
        // everyone else.
        isMember: true,
        isAdmin: isAdmin(callerTags),
      },
      mcp: {
        enabled: config.server.mcp.enabled,
        // Trailing slashes on either half would produce `//mcp`, which some
        // clients normalize and some send verbatim — and a 404 on a URL somebody
        // copied out of the UI is the least debuggable kind.
        url: `${config.server.web.applicationUrl.replace(/\/+$/, "")}${config.server.mcp.route}`,
      },
    };
  }
}
