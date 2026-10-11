import { eq } from "drizzle-orm";
import {
  type Action,
  type ActionParams,
  api,
  Connection,
  ErrorType,
  HTTP_METHOD,
  RateLimitMiddleware,
  type SessionData,
  secret,
  TypedError,
} from "keryx";
import { z } from "zod";
import { type SessionImpl, SessionMiddleware } from "../middleware/session";
import { checkPassword, serializeUser } from "../ops/UserOps";
import { users } from "../schema/users";

/**
 * `session:create` — sign in with email and password. Tagged `isLoginAction` so
 * Keryx's `/oauth/authorize` page renders a "sign in" tab from this action's Zod
 * schema, which is why every field is `.describe()`d.
 */
export class SessionCreate implements Action {
  name = "session:create";
  description =
    "Sign in with an email and password. Creates an authenticated session and returns the user's profile. Call this before any endpoint that requires authentication.";
  mcp = { tool: false, isLoginAction: true };
  middleware = [RateLimitMiddleware];
  web = { route: "/session", method: HTTP_METHOD.PUT };
  inputs = z.object({
    email: z
      .string()
      .refine(
        (val) => val.includes("@") && val.includes("."),
        "Must be a valid email address",
      )
      .transform((val) => val.toLowerCase())
      .describe("Your email address"),
    password: secret(
      z.string().min(8, "Password must be at least 8 characters"),
    ).describe("Your password"),
  });

  /**
   * Verify the credentials, then create a session. An unknown email and a wrong
   * password produce the *same* error, so this endpoint reveals nothing about
   * which accounts exist. The session is regenerated immediately after the id is
   * bound to the user, which is the session-fixation defense: a session id an
   * attacker planted before login is not the one that ends up authenticated.
   * @param params - The validated credentials.
   * @param connection - The caller's connection (the session is written here).
   * @returns The signed-in user and their session.
   */
  // @ts-ignore - the return type is a valid action response; annotating it
  // explicitly keeps `ActionResponse<SessionCreate>` usable on the frontend.
  run = async (
    params: ActionParams<SessionCreate>,
    connection: Connection<SessionImpl>,
  ): Promise<{
    user: ReturnType<typeof serializeUser>;
    session: SessionData<SessionImpl>;
  }> => {
    const [user] = await api.db.db
      .select()
      .from(users)
      .where(eq(users.email, params.email))
      .limit(1);

    const passwordMatch = user
      ? await checkPassword(user, params.password)
      : false;

    if (!user || !passwordMatch) {
      throw new TypedError({
        message: "Invalid email or password",
        type: ErrorType.CONNECTION_ACTION_RUN,
      });
    }

    await connection.updateSession({ userId: user.id });
    await connection.regenerateSession();

    return { user: serializeUser(user), session: connection.session! };
  };
}

/**
 * `session:destroy` — sign out by destroying the current session.
 */
export class SessionDestroy implements Action {
  name = "session:destroy";
  description =
    "Sign out by destroying the current authenticated session. Requires an active session.";
  web = { route: "/session", method: HTTP_METHOD.DELETE };
  middleware = [RateLimitMiddleware, SessionMiddleware];
  inputs = z.object({});

  /**
   * @param _params - No inputs; the session identifies itself.
   * @param connection - The caller's connection (its session is destroyed).
   * @returns `{ success: true }` once the session is gone.
   */
  async run(
    _params: ActionParams<SessionDestroy>,
    connection: Connection<SessionImpl>,
  ) {
    await api.session.destroy(connection);
    return { success: true };
  }
}
