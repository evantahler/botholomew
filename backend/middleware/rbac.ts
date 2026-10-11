import { and, eq } from "drizzle-orm";
import {
  type ActionMiddleware,
  api,
  Connection,
  ErrorType,
  TypedError,
} from "keryx";
import { getCallerTags, isAdmin } from "../ops/MembershipOps";
import { ADMIN_TAG } from "../ops/TagOps";
import {
  type ProjectMembership,
  projectMemberships,
} from "../schema/project_memberships";
import { type Project, projects } from "../schema/projects";
import type { Tag } from "../schema/tags";
import type { SessionImpl } from "./session";

/**
 * Well-known symbol tagging RBAC middleware with a machine-readable requirement
 * descriptor. Because the descriptor is attached to the exact middleware object
 * that performs the runtime check, the `actions:permissions` introspection
 * endpoint — and therefore the UI that gates on it — cannot drift from what is
 * actually enforced.
 */
export const RBAC_DESCRIPTOR = Symbol.for("botholomew.rbac");

/**
 * **The** list of RBAC levels in Botholomew, least to most privileged. This is the
 * single place they are enumerated: the requirement type, the middleware
 * descriptors, `actions:permissions`, and the frontend's gating all derive from
 * here, so a new level cannot be added to one and forgotten in another.
 *
 * - `none` — no project-scoped RBAC middleware on the action.
 * - `member` — the caller belongs to `params.projectId`.
 * - `admin` — the caller additionally holds the reserved {@link ADMIN_TAG}.
 *
 * There is deliberately no role ladder beyond this: membership reads, `admin`
 * administers, and everything finer-grained is a tag.
 */
export const RBAC_LEVELS = ["none", "member", "admin"] as const;

/** One of {@link RBAC_LEVELS}. */
export type RbacLevel = (typeof RBAC_LEVELS)[number];

/** The permission an action requires, as reported by `actions:permissions`. */
export type RbacRequirement = { type: RbacLevel };

/**
 * The one shared connection-metadata type for the whole app. The RBAC middleware
 * writes `project` / `membership` / `callerTags`; the `audit*` fields are the
 * channel an `AuditedAction` uses to hand its audit row everything the row cannot
 * infer from the action's params.
 *
 * They live on the one shared type, rather than on a type of their own, because
 * every action signature names this type as its connection metadata; a second
 * type would mean touching every generic parameter in every action signature.
 */
export interface RbacConnectionMeta {
  project?: Project;
  membership?: ProjectMembership;
  callerTags?: Tag[];
  /** Pre-mutation snapshot captured by an `AuditedAction`, always serializer output. */
  auditBefore?: unknown;
  /** Post-mutation snapshot captured by an `AuditedAction`, always serializer output. */
  auditAfter?: unknown;
  /** Explicit, already-scrubbed audit metadata overriding the scrubbed action params. */
  auditMetadata?: Record<string, unknown>;
  /**
   * The project to scope the audit row to, when it is not `params.projectId`.
   * Needed by the handful of mutations that change a project's contents without
   * naming the project: `project:create` (the id does not exist until the write)
   * and `invite:accept` / `invite:reject` (the project is on the invite row).
   * Without it those rows would be written with a null `projectId` and be
   * invisible to `audit:list`, which filters by project.
   */
  auditProjectId?: number;
  /** The kind of entity the action acted on, e.g. `"tag"`. */
  auditTargetType?: string;
  /** How to identify that entity to a human, e.g. a tag's name or a user's email. */
  auditTargetPath?: string;
}

/**
 * Load and enforce the caller's access to `params.projectId`, writing the
 * resolved project, membership, and tags onto `connection.metadata` for the
 * action to consume. Optionally also requires the reserved `admin` tag.
 * @param params - The validated action params (must carry a numeric `projectId`).
 * @param connection - The caller's connection (must have an active session).
 * @param options.requireAdmin - When true, also assert the caller holds `admin`.
 * @throws {TypedError} `CONNECTION_SESSION_NOT_FOUND` if unauthenticated;
 *   `CONNECTION_ACTION_PARAM_VALIDATION` if `projectId` is missing or not numeric;
 *   `CONNECTION_CHANNEL_AUTHORIZATION` if not a member (or not an admin).
 */
async function loadProjectAccess(
  params: { projectId?: unknown },
  connection: Connection<SessionImpl, RbacConnectionMeta>,
  options: { requireAdmin: boolean },
): Promise<void> {
  const userId = connection.session?.data.userId;
  if (!userId) {
    throw new TypedError({
      message: "Session not found",
      type: ErrorType.CONNECTION_SESSION_NOT_FOUND,
    });
  }

  const projectId = params.projectId;
  if (typeof projectId !== "number") {
    throw new TypedError({
      message: "A numeric projectId is required",
      type: ErrorType.CONNECTION_ACTION_PARAM_VALIDATION,
      key: "projectId",
    });
  }

  const [membership] = await api.db.db
    .select()
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.projectId, projectId),
      ),
    )
    .limit(1);

  // Deliberately the same error whether the project does not exist or the caller
  // simply is not in it — otherwise this endpoint enumerates project ids.
  if (!membership) {
    throw new TypedError({
      message: "You are not a member of this project",
      type: ErrorType.CONNECTION_CHANNEL_AUTHORIZATION,
    });
  }

  const callerTags = await getCallerTags(userId, projectId);

  if (options.requireAdmin && !isAdmin(callerTags)) {
    throw new TypedError({
      message: `This action requires the "${ADMIN_TAG}" tag on this project`,
      type: ErrorType.CONNECTION_CHANNEL_AUTHORIZATION,
    });
  }

  const [project] = await api.db.db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  connection.metadata.project = project;
  connection.metadata.membership = membership;
  connection.metadata.callerTags = callerTags;
}

/**
 * Middleware factory requiring the caller to be a member of `params.projectId`.
 * On success it populates `connection.metadata` with `project`, `membership`, and
 * `callerTags`, and tags itself `{ type: "member" }` for introspection.
 *
 * A factory rather than a singleton precisely so each returned object can carry
 * its own {@link RBAC_DESCRIPTOR} property.
 * @returns A member-gating {@link ActionMiddleware}.
 */
export function ProjectMemberMiddleware(): ActionMiddleware & {
  [RBAC_DESCRIPTOR]?: RbacRequirement;
} {
  const mw: ActionMiddleware & { [RBAC_DESCRIPTOR]?: RbacRequirement } = {
    runBefore: async (params, connection) => {
      await loadProjectAccess(
        params,
        connection as Connection<SessionImpl, RbacConnectionMeta>,
        { requireAdmin: false },
      );
    },
  };
  mw[RBAC_DESCRIPTOR] = { type: "member" };
  return mw;
}

/**
 * Middleware factory requiring the caller to be a member of `params.projectId`
 * *and* hold the reserved `admin` tag. Populates `connection.metadata` exactly
 * like {@link ProjectMemberMiddleware} and tags itself `{ type: "admin" }`.
 * @returns An admin-gating {@link ActionMiddleware}.
 */
export function AdminMiddleware(): ActionMiddleware & {
  [RBAC_DESCRIPTOR]?: RbacRequirement;
} {
  const mw: ActionMiddleware & { [RBAC_DESCRIPTOR]?: RbacRequirement } = {
    runBefore: async (params, connection) => {
      await loadProjectAccess(
        params,
        connection as Connection<SessionImpl, RbacConnectionMeta>,
        { requireAdmin: true },
      );
    },
  };
  mw[RBAC_DESCRIPTOR] = { type: "admin" };
  return mw;
}
