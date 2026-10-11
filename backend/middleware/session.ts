import {
  type ActionMiddleware,
  Connection,
  ErrorType,
  TypedError,
} from "keryx";

/**
 * The session shape Botholomew stores in Redis: just the signed-in user's id.
 * Everything else about the caller (their projects, their tags) is read from the
 * database per request, so a permission change takes effect immediately rather
 * than at the next login.
 */
export type SessionImpl = { userId?: number };

/**
 * Requires an authenticated session. Throws `CONNECTION_SESSION_NOT_FOUND`
 * (HTTP 401) when the connection carries no `userId`, so every action behind it
 * can safely read `connection.session!.data.userId!`.
 */
export const SessionMiddleware: ActionMiddleware = {
  runBefore: async (_params, connection: Connection<SessionImpl>) => {
    if (!connection.session?.data.userId) {
      throw new TypedError({
        message: "Session not found",
        type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
      });
    }
  },
};
