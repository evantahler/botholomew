import { eq } from "drizzle-orm";
import { api } from "../api";
import {
  toolkit_authorizations,
  ToolkitAuthorization,
} from "../models/toolkit_authorization";

export function serializeToolkitAuthorization(tka: ToolkitAuthorization) {
  return {
    id: tka.id,
    toolkitName: tka.toolkitName,
    userId: tka.userId,
    createdAt: tka.createdAt.getTime(),
    updatedAt: tka.updatedAt.getTime(),
  };
}

export async function isUserAuthorizedForToolkits(
  userId: number,
  toolkitNames: string[],
): Promise<boolean> {
  if (toolkitNames.length === 0) {
    return true; // No toolkits means no authorization needed
  }

  // Get all toolkit authorizations for the user
  const userAuthorizations: { toolkitName: string }[] = await api.db.db
    .select({ toolkitName: toolkit_authorizations.toolkitName })
    .from(toolkit_authorizations)
    .where(eq(toolkit_authorizations.userId, userId));

  const authorizedToolkitNames = userAuthorizations.map(
    (auth) => auth.toolkitName,
  );

  // Check if all requested toolkits are in the authorized list
  return toolkitNames.every((toolkitName) =>
    authorizedToolkitNames.includes(toolkitName),
  );
}

export async function getUnauthorizedToolkits(
  userId: number,
  toolkitNames: string[],
): Promise<string[]> {
  if (toolkitNames.length === 0) {
    return [];
  }

  // Get all toolkit authorizations for the user
  const userAuthorizations = await api.db.db
    .select({ toolkitName: toolkit_authorizations.toolkitName })
    .from(toolkit_authorizations)
    .where(eq(toolkit_authorizations.userId, userId));

  const authorizedToolkitNames = userAuthorizations.map(
    (auth) => auth.toolkitName,
  );

  // Return toolkits that are not in the authorized list
  return toolkitNames.filter(
    (toolkitName) => !authorizedToolkitNames.includes(toolkitName),
  );
}
