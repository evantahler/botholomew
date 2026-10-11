import { type ActionParams, HTTP_METHOD, RateLimitMiddleware } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { SessionMiddleware } from "../../middleware/session";
import { serializeMembership } from "../../ops/MembershipOps";
import { createProjectForOwner, serializeProject } from "../../ops/ProjectOps";

/**
 * `project:create` — explicitly create a project owned by the caller, who
 * becomes its first member and receives the reserved `admin` tag (the same
 * bootstrap signup performs). Most users get their first project automatically;
 * this exists for additional ones.
 *
 * The audit row is scoped with `auditProjectId` rather than `params.projectId`,
 * because the id being audited does not exist until the insert two lines above
 * it. Without that, a project's very first log entry would be filed under no
 * project and never appear in its own audit list.
 */
export class ProjectCreate extends AuditedAction {
  name = "project:create";
  description =
    "Create a new project. The caller becomes its first member and receives the reserved admin tag. Requires an active session.";
  middleware = [RateLimitMiddleware, SessionMiddleware];
  web = { route: "/project", method: HTTP_METHOD.PUT };
  inputs = z.object({
    name: z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(256, "Name must be less than 256 characters")
      .describe("The display name for the new project"),
  });

  /**
   * @param tx - The transaction the bootstrap and its audit row share.
   * @param params - The validated inputs (`name`).
   * @param connection - The caller's connection (session required).
   * @returns The created project and the caller's membership.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<ProjectCreate>,
    connection: AuditedConnection,
  ) {
    const userId = connection.session!.data.userId!;

    const { project, membership } = await createProjectForOwner(
      tx,
      userId,
      params.name,
    );

    const serialized = serializeProject(project);
    connection.metadata.auditProjectId = project.id;
    connection.metadata.auditAfter = serialized;
    connection.metadata.auditTargetType = "project";
    connection.metadata.auditTargetPath = project.slug;

    return {
      project: serialized,
      membership: serializeMembership(membership),
    };
  }
}
