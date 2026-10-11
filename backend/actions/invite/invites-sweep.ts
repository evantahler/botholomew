import { lt } from "drizzle-orm";
import { type Action, api } from "keryx";
import { z } from "zod";
import { projectInvites } from "../../schema/project_invites";

/**
 * `invites:sweep` — deletes invites whose `expiresAt` has passed. Runs daily as
 * a background sweeper. Task-only: not exposed over HTTP. `mcp = { tool: false }`
 * because it is operational, not something a person's assistant should hold.
 *
 * Read-only actions and sweep tasks stay plain `Action`s: they are not audited
 * — because a retention sweep is not somebody's decision.
 */
export class InvitesSweep implements Action {
  name = "invites:sweep";
  description =
    "Delete expired project invitations. Runs automatically once per day; not exposed over HTTP.";
  mcp = { tool: false };
  task = { queue: "default", frequency: 1000 * 60 * 60 * 24 };
  inputs = z.object({});

  /**
   * Delete every invite past its expiry.
   * @returns The number of invites deleted.
   */
  async run() {
    const deleted = await api.db.db
      .delete(projectInvites)
      .where(lt(projectInvites.expiresAt, new Date()))
      .returning();
    return { deleted: deleted.length };
  }
}
