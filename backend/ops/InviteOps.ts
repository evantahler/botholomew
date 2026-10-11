import type { ProjectInvite } from "../schema/project_invites";

/** How long an invite remains valid before it expires: five days, in ms. */
export const INVITE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

/** The invite lifecycle states stored in `project_invites.status`. */
export const INVITE_STATUS = {
  pending: "pending",
  accepted: "accepted",
  rejected: "rejected",
} as const;

/**
 * Whether an invite has passed its expiry timestamp.
 * @param invite - The invite row to check.
 * @param now - The reference time (defaults to the current time).
 * @returns `true` if the invite is expired.
 */
export function isExpired(
  invite: ProjectInvite,
  now: Date = new Date(),
): boolean {
  return invite.expiresAt.getTime() <= now.getTime();
}

/**
 * Shape an invite row into the API-safe object returned by actions. Timestamps
 * are emitted as epoch milliseconds.
 * @param invite - The invite row from the database.
 * @returns The serialized invite.
 */
export function serializeInvite(invite: ProjectInvite) {
  return {
    id: invite.id,
    projectId: invite.projectId,
    inviterUserId: invite.inviterUserId,
    inviteeEmail: invite.inviteeEmail,
    tagIds: invite.tagIds,
    status: invite.status,
    inviterEmail: invite.inviterEmail,
    projectName: invite.projectName,
    createdAt: invite.createdAt.getTime(),
    expiresAt: invite.expiresAt.getTime(),
  };
}
