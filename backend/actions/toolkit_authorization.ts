import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { Action, type ActionParams, api, Connection } from "../api";
import { HTTP_METHOD } from "../classes/Action";
import { ErrorType, TypedError } from "../classes/TypedError";
import { SessionMiddleware } from "../middleware/session";
import { toolkit_authorizations } from "../models/toolkit_authorization";
import { users } from "../models/user";
import { serializeToolkitAuthorization } from "../ops/ToolkitAuthorizationOps";

export class ToolkitAuthorizationList implements Action {
  name = "toolkit_authorization:list";
  description = "List all authorized toolkits for the current user";
  web = { route: "/toolkit-authorizations", method: HTTP_METHOD.GET };
  middleware = [SessionMiddleware];

  async run(
    params: ActionParams<ToolkitAuthorizationList>,
    connection: Connection,
  ) {
    const toolkitAuthorizations = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(
        eq(toolkit_authorizations.userId, connection.session!.data.userId),
      );

    return {
      toolkitAuthorizations: toolkitAuthorizations.map(
        serializeToolkitAuthorization,
      ),
    };
  }
}

export class ToolkitAuthorizationCreate implements Action {
  name = "toolkit_authorization:create";
  description = "Authorize a toolkit for the current user";
  web = { route: "/toolkit-authorizations", method: HTTP_METHOD.PUT };
  middleware = [SessionMiddleware];
  inputs = z.object({
    toolkitName: z
      .string()
      .min(1, "Toolkit name is required")
      .max(256, "Toolkit name must be less than 256 characters")
      .describe("The name of the toolkit to authorize"),
  });

  async run(
    params: ActionParams<ToolkitAuthorizationCreate>,
    connection: Connection,
  ) {
    const response = {
      toolkitAuthorization: null as ReturnType<
        typeof serializeToolkitAuthorization
      > | null,
      authUrl: null as string | null,
    };

    const { toolkitName } = params;
    const userId = connection.session!.data.userId;

    // Check if authorization already exists
    const [existingAuth] = await api.db.db
      .select()
      .from(toolkit_authorizations)
      .where(
        and(
          eq(toolkit_authorizations.userId, userId),
          eq(toolkit_authorizations.toolkitName, toolkitName),
        ),
      )
      .limit(1);

    if (existingAuth) {
      throw new TypedError({
        message: "User is already authorized for this toolkit",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const [user] = await api.db.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new TypedError({
        message: "User not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    const authUrl = await api.arcade.authorizeToolkitForUser(
      toolkitName,
      user.email,
    );

    if (authUrl) {
      response.authUrl = authUrl;
      return response;
    }

    const [tka] = await api.db.db
      .insert(toolkit_authorizations)
      .values({
        userId,
        toolkitName,
      })
      .returning();

    response.toolkitAuthorization = serializeToolkitAuthorization(tka);

    return response;
  }
}

export class ToolkitAuthorizationDelete implements Action {
  name = "toolkit_authorization:delete";
  description = "Deauthorize a toolkit for the current user";
  web = { route: "/toolkit-authorizations", method: HTTP_METHOD.DELETE };
  middleware = [SessionMiddleware];
  inputs = z.object({
    toolkitName: z
      .string()
      .min(1, "Toolkit name is required")
      .max(256, "Toolkit name must be less than 256 characters")
      .describe("The name of the toolkit to deauthorize"),
  });

  async run(
    params: ActionParams<ToolkitAuthorizationDelete>,
    connection: Connection,
  ) {
    const { toolkitName } = params;
    const userId = connection.session!.data.userId;

    const [deletedTka] = await api.db.db
      .delete(toolkit_authorizations)
      .where(
        and(
          eq(toolkit_authorizations.userId, userId),
          eq(toolkit_authorizations.toolkitName, toolkitName),
        ),
      )
      .returning();

    if (!deletedTka) {
      throw new TypedError({
        message: "Toolkit authorization not found",
        type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      });
    }

    return { toolkitAuthorization: serializeToolkitAuthorization(deletedTka) };
  }
}
