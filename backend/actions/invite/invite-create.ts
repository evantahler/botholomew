import { and, eq, inArray } from "drizzle-orm";
import {
  type ActionParams,
  ErrorType,
  HTTP_METHOD,
  RateLimitMiddleware,
  TypedError,
} from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../../classes/AuditedAction";
import { AdminMiddleware } from "../../middleware/rbac";
import {
  INVITE_STATUS,
  INVITE_TTL_MS,
  serializeInvite,
} from "../../ops/InviteOps";
import { getUserById } from "../../ops/UserOps";
import { projectInvites } from "../../schema/project_invites";
import { tags } from "../../schema/tags";

/**
 * `invite:create` — an admin invites an email address to join a project with a set
 * of tags. The inviter's email and the project's name are denormalized onto the
 * row so the invitee's card renders without joins.
 */
export class InviteCreate extends AuditedAction {
  name = "invite:create";
  description =
    "Invite a person (by email) to join a project, granting them a set of tags when they accept. Requires the admin tag on the project. No email is sent — the invite appears in-app for the invitee on their next sign-in, and expires after five days.";
  middleware = [RateLimitMiddleware, AdminMiddleware()];
  web = { route: "/invite", method: HTTP_METHOD.PUT };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project to invite the person to"),
    inviteeEmail: z
      .string()
      .refine(
        (val) => val.includes("@") && val.includes("."),
        "Must be a valid email address",
      )
      .transform((val) => val.toLowerCase())
      .describe("Email address of the person to invite"),
    tagIds: z
      .array(z.coerce.number().int().positive())
      .default([])
      .describe("Ids of the project tags to grant the invitee on acceptance"),
  });

  /**
   * @param tx - The transaction the insert and its audit row share.
   * @param params - The validated invite inputs.
   * @param connection - The admin caller's connection (project set by middleware).
   * @returns The created invite.
   * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` if any `tagIds` entry does not belong
   *   to this project.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<InviteCreate>,
    connection: AuditedConnection,
  ) {
    const userId = connection.session!.data.userId!;
    const project = connection.metadata.project!;

    if (params.tagIds.length > 0) {
      const projectTags = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            eq(tags.projectId, params.projectId),
            inArray(tags.id, params.tagIds),
          ),
        );
      if (projectTags.length !== new Set(params.tagIds).size) {
        throw new TypedError({
          message: "One or more tagIds do not belong to this project",
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
          key: "tagIds",
        });
      }
    }

    const inviter = await getUserById(userId, tx);

    const [invite] = await tx
      .insert(projectInvites)
      .values({
        projectId: params.projectId,
        inviterUserId: userId,
        inviteeEmail: params.inviteeEmail,
        tagIds: params.tagIds,
        status: INVITE_STATUS.pending,
        inviterEmail: inviter?.email ?? "",
        projectName: project.name,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();

    const serialized = serializeInvite(invite);
    connection.metadata.auditAfter = serialized;
    connection.metadata.auditTargetType = "invite";
    connection.metadata.auditTargetPath = invite.inviteeEmail;

    return { invite: serialized };
  }
}
