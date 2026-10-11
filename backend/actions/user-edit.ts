import { and, eq, ne } from "drizzle-orm";
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
import { SessionMiddleware } from "../middleware/session";
import { hashPassword, serializeUser } from "../ops/UserOps";
import { type User, users } from "../schema/users";

/**
 * `user:edit` — update your own account. The record edited comes from the
 * session, never from an id param: there is no shape of this request that lets
 * one user edit another.
 *
 * Its audit row carries no `projectId`, which is correct rather than an
 * oversight — an account is not project-scoped, so a password change has no
 * business appearing in a project's log.
 */
export class UserEdit extends AuditedAction {
  name = "user:edit";
  description =
    "Update your own account's name, email, and/or password. Requires an active session. The email must remain unique (case-insensitive) and the password must be at least 8 characters. Returns the updated user.";
  middleware = [RateLimitMiddleware, SessionMiddleware];
  web = { route: "/user", method: HTTP_METHOD.POST };
  inputs = z.object({
    name: z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(256, "Name must be less than 256 characters")
      .optional()
      .describe("A new display name"),
    email: z
      .string()
      .refine(
        (val) => val.includes("@") && val.includes("."),
        "Must be a valid email address",
      )
      .transform((val) => val.toLowerCase())
      .optional()
      .describe("A new email address (must be unique, case-insensitive)"),
    password: secret(
      z.string().min(8, "Password must be at least 8 characters").optional(),
    ).describe("A new password of at least 8 characters"),
  });

  /**
   * @param tx - The transaction the update and its audit row share.
   * @param params - The validated inputs (any of `name`, `email`, `password`).
   * @param connection - The caller's connection (session required).
   * @returns The updated user, never including the password hash.
   * @throws {TypedError} `CONNECTION_ACTION_PARAM_VALIDATION` if the new email belongs to someone else.
   */
  async runWithAudit(
    tx: TxHandle,
    params: ActionParams<UserEdit>,
    connection: AuditedConnection,
  ) {
    const userId = connection.session!.data.userId!;

    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!existing) {
      throw new TypedError({
        message: "User not found",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }

    connection.metadata.auditBefore = serializeUser(existing);
    connection.metadata.auditTargetType = "user";
    connection.metadata.auditTargetPath = existing.email;

    const updates: Partial<Pick<User, "name" | "email" | "password_hash">> = {};

    if (params.name !== undefined) updates.name = params.name;

    if (params.email !== undefined && params.email !== existing.email) {
      const [conflict] = await tx
        .select()
        .from(users)
        .where(and(eq(users.email, params.email), ne(users.id, userId)))
        .limit(1);
      if (conflict) {
        throw new TypedError({
          message: "A user with that email already exists",
          type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
          key: "email",
        });
      }
      updates.email = params.email;
    }

    if (params.password !== undefined) {
      updates.password_hash = await hashPassword(params.password);
    }

    // An empty update is not an error — the frontend only sends changed fields,
    // and "nothing changed" should read back as the current user. It still sets
    // `auditAfter` before returning, so the row records an edit that changed
    // nothing rather than an edit that appears to have deleted the user.
    if (Object.keys(updates).length === 0) {
      const serialized = serializeUser(existing);
      connection.metadata.auditAfter = serialized;
      return { user: serialized };
    }

    const [updated] = await tx
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning();

    const serialized = serializeUser(updated);
    connection.metadata.auditAfter = serialized;
    return { user: serialized };
  }
}
