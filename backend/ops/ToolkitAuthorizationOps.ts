import { ToolkitAuthorization } from "../models/toolkit_authorization";

export function serializeToolkitAuthorization(tka: ToolkitAuthorization) {
  return {
    id: tka.id,
    toolkitName: tka.toolkitName,
    userId: tka.userId,
    createdAt: tka.createdAt.getTime(),
    updatedAt: tka.updatedAt.getTime(),
  };
}
