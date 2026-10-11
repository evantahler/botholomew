import type { RbacLevel } from "@backend/middleware/rbac";
import type { Permissions } from "../context/AuthContext";

/** What the caller is within the project being displayed. */
export interface ProjectStanding {
  /** They hold a membership in it. */
  isMember: boolean;
  /** They additionally hold the reserved `admin` tag in it. */
  isAdmin: boolean;
}

/**
 * Whether the caller may invoke an action in a project, by asking the backend's
 * own RBAC map what that action requires and comparing it to their standing.
 *
 * This is the only place the frontend decides what to show. It never hardcodes
 * "renaming needs admin" — it reads `project:edit`'s requirement from
 * `actions:permissions`, which is generated from the very middleware that
 * enforces it. Move an action from admin to member on the backend and this
 * follows, with no frontend change.
 *
 * Gating is cosmetic either way: hiding a control the server would refuse is a
 * courtesy, not the enforcement.
 * @param permissions - The map from `actions:permissions` (null while loading).
 * @param actionName - The action to test, e.g. `"tag:create"`.
 * @param standing - The caller's standing in the project on screen.
 * @returns `true` if the action should be offered.
 */
export function can(
  permissions: Permissions | null,
  actionName: string,
  standing: ProjectStanding,
): boolean {
  // Unknown action or permissions not loaded: assume it is gated. Showing a
  // control that 403s is worse than briefly hiding one.
  const requirement = permissions?.[actionName]?.type as RbacLevel | undefined;
  if (!requirement) return false;

  switch (requirement) {
    case "none":
      return true;
    case "member":
      return standing.isMember;
    case "admin":
      return standing.isAdmin;
    default:
      return false;
  }
}
