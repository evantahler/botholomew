import { type Action, api, HTTP_METHOD } from "keryx";
import { z } from "zod";
import { RBAC_DESCRIPTOR, type RbacRequirement } from "../middleware/rbac";

/**
 * Introspection endpoint reporting the RBAC requirement of every registered
 * action. The frontend gates its UI on this, so what it shows can never drift
 * from what the backend enforces — both derive from the same
 * {@link RBAC_DESCRIPTOR} attached to the middleware object that performs the
 * check. Unauthenticated on purpose: it exposes action names and requirement
 * levels only, never data.
 */
export class ActionsPermissions implements Action {
  name = "actions:permissions";
  description =
    "List every registered action and the permission it requires (member, admin, or none). Clients use this to gate their UI so it matches server-side enforcement. Requires no authentication.";
  web = { route: "/actions/permissions", method: HTTP_METHOD.GET };
  inputs = z.object({});

  /**
   * Walk the action registry, taking each action's first RBAC descriptor and
   * defaulting to `{ type: "none" }` when no RBAC middleware is present.
   * @returns A map of action name to its permission requirement.
   */
  async run() {
    const permissions: Record<string, RbacRequirement> = {};

    for (const action of api.actions.actions) {
      let requirement: RbacRequirement = { type: "none" };
      for (const mw of action.middleware ?? []) {
        const descriptor = (mw as Record<symbol, RbacRequirement | undefined>)[
          RBAC_DESCRIPTOR
        ];
        if (descriptor) {
          requirement = descriptor;
          break;
        }
      }
      permissions[action.name] = requirement;
    }

    return { permissions };
  }
}
