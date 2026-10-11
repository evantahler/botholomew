import { and, eq } from "drizzle-orm";
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
import { serializeMembership } from "../../ops/MembershipOps";
import { projectMemberships } from "../../schema/project_memberships";
import { users } from "../../schema/users";

/**
 * `membership:create` — an admin adds an **existing** user to a project by email.
 * For someone who does not have an account yet, use `invite:create` instead.
 * Requires the admin tag on the project.
 */
export class MembershipCreate extends AuditedAction {
  name = "membership:create";
  description =
    "Add an existing user (by email) to a project as a member. The user must already have an account — to invite a new person by email, use invite:create. Requires the admin tag on the project.";
  middleware = [RateLimitMiddleware, AdminMiddleware()];
  web = { route: "/membership", method: HTTP_METHOD.PUT };
  inputs = z.object({
    projectId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The project to add the user to"),
    email: z
      .string()
      .refine(
        (val) => val.includes("@") && val.includes("."),
        "Must be a valid email address",
      )
      .transform((val) => val.toLowerCase())
      .describe("Email of the existing user to add"),
  });

  /**
   * @param tx - The transaction the insert and its audit row share.
   * @param params - The validated inputs (`projectId`, `email`).
   * @param connection - The caller's connection (audit snapshots written here).
   * @returns The created membership.
   * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` if no such user exists, or they are
   *   already a member.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<MembershipCreate>,
    connection: AuditedConnection,
  ) {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, params.email))
      .limit(1);

    if (!user) {
      throw new TypedError({
        message: "No user found with that email",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "email",
      });
    }

    const [existing] = await tx
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.userId, user.id),
          eq(projectMemberships.projectId, params.projectId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new TypedError({
        message: "That user is already a member of this project",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "email",
      });
    }

    const [membership] = await tx
      .insert(projectMemberships)
      .values({ userId: user.id, projectId: params.projectId })
      .returning();

    const serialized = serializeMembership(membership);
    connection.metadata.auditAfter = serialized;
    connection.metadata.auditTargetType = "membership";
    connection.metadata.auditTargetPath = user.email;

    return { membership: serialized };
  }
}
