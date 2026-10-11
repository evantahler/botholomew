import { eq } from "drizzle-orm";
import {
  type Action,
  type ActionParams,
  api,
  Connection,
  ErrorType,
  HTTP_METHOD,
  TypedError,
} from "keryx";
import { z } from "zod";
import { type SessionImpl, SessionMiddleware } from "../middleware/session";
import { serializeUser } from "../ops/UserOps";
import { users } from "../schema/users";

/**
 * `me:view` — the signed-in user's own profile. The frontend's auth context
 * hydrates from this on every page load, and a 401 here is what tells it the
 * session is gone.
 */
export class MeView implements Action {
  name = "me:view";
  description =
    "Get the currently authenticated user's profile. Requires an active session.";
  web = { route: "/me", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];
  inputs = z.object({});

  /**
   * @param _params - No inputs; the caller is identified by their session.
   * @param connection - The caller's connection (session required).
   * @returns The signed-in user.
   */
  async run(
    _params: ActionParams<MeView>,
    connection: Connection<SessionImpl>,
  ) {
    const [user] = await api.db.db
      .select()
      .from(users)
      .where(eq(users.id, connection.session!.data.userId!))
      .limit(1);

    if (!user) {
      throw new TypedError({
        message: "User not found",
        type: ErrorType.CONNECTION_ACTION_NOT_FOUND,
      });
    }

    return { user: serializeUser(user) };
  }
}
