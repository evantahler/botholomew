import { eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { generateSlug, serializeProject } from "../../ops/ProjectOps";
import { projects } from "../../schema/projects";

/**
 * `project:edit` — rename a project. The slug is regenerated from the new name.
 * Requires the admin tag on the project.
 */
export class ProjectEdit extends AuditedAction {
  name = "project:edit";
  description =
    "Rename a project; its slug is regenerated from the new name. Requires the admin tag on the project.";
  middleware = [AdminMiddleware()];
  web = { route: "/project", method: HTTP_METHOD.POST };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The id of the project to rename"),
    name: z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(256, "Name must be less than 256 characters")
      .describe("The new display name for the project"),
  });

  /**
   * @param tx - The transaction the rename and its audit row share.
   * @param params - The validated inputs (`projectId`, `name`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns The updated project.
   * @throws {TypedError} `CONNECTION_ACTION_NOT_FOUND` if the project has since been deleted.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<ProjectEdit>,
    connection: AuditedConnection,
  ) {
    // Read the pre-mutation snapshot inside this transaction, not from the copy
    // the RBAC middleware loaded earlier on a different connection — that one was
    // read before the transaction opened, and `before` must be what the update
    // actually replaced.
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
    connection.metadata.auditBefore = serializeProject(existing);

    const [project] = await tx
      .update(projects)
      .set({ name: params.name, slug: generateSlug(params.name) })
      .where(eq(projects.id, params.projectId))
      .returning();

    const serialized = serializeProject(project);
    connection.metadata.auditAfter = serialized;
    connection.metadata.auditTargetType = "project";
    connection.metadata.auditTargetPath = project.slug;

    return { project: serialized };
  }
}
