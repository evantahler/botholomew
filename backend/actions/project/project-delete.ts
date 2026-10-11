import { eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { serializeProject } from "../../ops/ProjectOps";
import { projects } from "../../schema/projects";

/**
 * `project:delete` — permanently delete a project and everything scoped to it.
 * Deleting the project row cascades at the database level (`ON DELETE cascade`)
 * to its tags, the user-tag assignments those tags own, its memberships, and its
 * invites — so this stays a one-statement delete as new project-scoped tables
 * are added. Requires the admin tag on the project.
 *
 * The project's audit log is the one thing that does **not** go with it:
 * `audit_logs.projectId` carries no foreign key precisely so the record of a
 * deletion outlives the thing deleted, this row included.
 *
 * The one statement holds only while nothing scoped to a project lives outside
 * Postgres. A project-scoped table whose rows describe something elsewhere —
 * compute that keeps billing, a credential a third party still honours — would
 * lose its only record of that thing in the cascade, and is the point at which
 * this action stops being one statement.
 */
export class ProjectDelete extends AuditedAction {
  name = "project:delete";
  description =
    "Permanently delete a project and everything scoped to it — its tags, memberships, and invites. Requires the admin tag on the project. This cannot be undone.";
  middleware = [AdminMiddleware()];
  web = { route: "/project", method: HTTP_METHOD.DELETE };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the project to delete"),
  });

  /**
   * @param tx - The transaction the delete and its audit row share.
   * @param params - The validated inputs (`projectId`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns `{ success: true }` on completion.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if the project has already been deleted.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<ProjectDelete>,
    connection: AuditedConnection,
  ) {
    const [existing] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!existing) {
      throw new TypedError({
        message: "Project not found",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }

    // `after` is left null: the entity is gone, and that asymmetry is
    // how the audit page renders a deletion.
    connection.metadata.auditBefore = serializeProject(existing);
    connection.metadata.auditTargetType = "project";
    connection.metadata.auditTargetPath = existing.slug;

    await tx.delete(projects).where(eq(projects.id, params.projectId));

    return { success: true };
  }
}
