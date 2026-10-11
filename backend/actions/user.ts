import { eq } from "drizzle-orm";
import {
  type ActionParams,
  ErrorType,
  HTTP_METHOD,
  RateLimitMiddleware,
  secret,
  TypedError,
} from "keryx";
import { z } from "zod";
import {
  AuditedAction,
  type AuditedConnection,
  type TxHandle,
} from "../classes/AuditedAction";
import { writeAuditLog } from "../ops/AuditOps";
import { serializeMembership } from "../ops/MembershipOps";
import { createProjectForOwner, serializeProject } from "../ops/ProjectOps";
import { hashPassword, serializeUser } from "../ops/UserOps";
import { users } from "../schema/users";

/**
 * `user:create` — register an account. Tagged `isSignupAction` so Keryx's
 * `/oauth/authorize` page renders a "sign up" tab generated from this action's
 * Zod schema, which is why every field is `.describe()`d.
 *
 * Signup is also the tenancy bootstrap: the user, their own project, their
 * membership, the reserved `admin` tag, and the user-tag linking them all land in
 * one transaction. A partial bootstrap would leave a project nobody can
 * administer, so there is no version of this that is safe to do in pieces.
 */
export class UserCreate extends AuditedAction {
  name = "user:create";
  description =
    "Register a new user account with a name, email, and password. The email must be unique (case-insensitive) and the password at least 8 characters. On signup the user is bootstrapped into their own project as its admin. Returns the created user, their project, and their membership.";
  mcp = { tool: false, isSignupAction: true };
  middleware = [RateLimitMiddleware];
  web = { route: "/user", method: HTTP_METHOD.PUT };
  inputs = z.object({
    name: z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(256, "Name must be less than 256 characters")
      .describe("Your display name"),
    email: z
      .string()
      .refine(
        (val) => val.includes("@") && val.includes("."),
        "Must be a valid email address",
      )
      .transform((val) => val.toLowerCase())
      .describe("Your email address (must be unique, case-insensitive)"),
    password: secret(
      z.string().min(8, "Password must be at least 8 characters"),
    ).describe("A password of at least 8 characters"),
  });

  /**
   * @param tx - The transaction the signup, the bootstrap, and both audit rows share.
   * @param params - The validated signup inputs.
   * @param connection - The (anonymous) caller's connection; audit snapshots written here.
   * @returns The created user, their new project, and their membership.
   * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` if the email is already registered.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<UserCreate>,
    connection: AuditedConnection,
  ) {
    const [existingUser] = await tx
      .select()
      .from(users)
      .where(eq(users.email, params.email))
      .limit(1);

    if (existingUser) {
      throw new TypedError({
        message: "A user with that email already exists",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
        key: "email",
      });
    }

    const password_hash = await hashPassword(params.password);

    const [user] = await tx
      .insert(users)
      .values({ name: params.name, email: params.email, password_hash })
      .returning();

    const { project, membership } = await createProjectForOwner(
      tx,
      user.id,
      `${user.name}'s Project`,
    );

    const serializedUser = serializeUser(user);
    const serializedProject = serializeProject(project);

    connection.metadata.auditAfter = serializedUser;
    connection.metadata.auditTargetType = "user";
    connection.metadata.auditTargetPath = user.email;

    // The signup row itself is deliberately left project-less: an account is not
    // project-scoped, and scoping it to the bootstrap project would put someone's
    // registration in a log their future teammates read. The bootstrap *project*
    // is different — it is created inside a shared ops helper and so bypasses
    // `project:create`'s own auditing entirely. Log it explicitly, on this same
    // transaction, or a project's log would open with no record of its creation.
    await writeAuditLog(tx, {
      userId: user.id,
      projectId: project.id,
      action: "project:create",
      targetType: "project",
      targetPath: project.slug,
      after: serializedProject,
      metadata: { name: project.name, bootstrappedBy: "user:create" },
    });

    return {
      user: serializedUser,
      project: serializedProject,
      membership: serializeMembership(membership),
    };
  }
}
