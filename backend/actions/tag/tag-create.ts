import { and, eq } from "drizzle-orm";
import { type ActionParams, ErrorType, HTTP_METHOD, TypedError } from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import { assertNotReservedTag, serializeTag } from "../../ops/TagOps";
import { tags } from "../../schema/tags";

/**
 * `tag:create` — create a permission tag in a project. Requires the admin tag;
 * reserved names (`RESERVED_TAGS`, currently just `admin`) cannot be created here.
 */
export class TagCreate extends AuditedAction {
  name = "tag:create";
  description =
    "Create a new permission tag in a project. Requires the admin tag on the project. The reserved 'admin' tag cannot be created.";
  middleware = [AdminMiddleware()];
  web = { route: "/tag", method: HTTP_METHOD.PUT };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project to create the tag in"),
    name: z
      .string()
      .min(1, "Tag name is required")
      .max(256, "Tag name must be less than 256 characters")
      .describe("The tag name (unique within the project)"),
  });

  /**
   * @param tx - The transaction the insert and its audit row share.
   * @param params - The validated inputs (`projectId`, `name`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns The created tag.
   * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` for a reserved name, or a name
   *   already used in this project.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<TagCreate>,
    connection: AuditedConnection,
  ) {
    assertNotReservedTag(params.name);

    const [existing] = await tx
      .select()
      .from(tags)
      .where(
        and(eq(tags.projectId, params.projectId), eq(tags.name, params.name)),
      )
      .limit(1);

    if (existing) {
      throw new TypedError({
        message: "A tag with that name already exists in this project",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "name",
      });
    }

    const [tag] = await tx
      .insert(tags)
      .values({ projectId: params.projectId, name: params.name })
      .returning();

    const serialized = serializeTag(tag);
    connection.metadata.auditAfter = serialized;
    connection.metadata.auditTargetType = "tag";
    connection.metadata.auditTargetPath = tag.name;

    return { tag: serialized };
  }
}
