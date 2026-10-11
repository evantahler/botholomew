import type { ProjectView } from "@backend/actions/project/project-view";
import type { ActionResponse } from "keryx";
import { useOutletContext } from "react-router-dom";
import type { ProjectStanding } from "../../utils/permissions";

/** The project as `project:view` returns it. */
export type Project = ActionResponse<ProjectView>["project"];

/** The MCP endpoint `project:view` reports, or `null` while it is loading. */
export type Mcp = ActionResponse<ProjectView>["mcp"];

/**
 * What the settings shell hands every section.
 *
 * Passed through the router's own outlet context rather than a React context:
 * `src/context/` means app-global state living inside `AuthProvider`, and the
 * route tree already gives the parent/child guarantee a provider would
 * re-declare.
 *
 * What is here is what **more than one simultaneously reachable section** needs,
 * and nothing else. Everything a single section reads, that section fetches — which
 * is what makes "a plain member never calls an admin-only endpoint" a property of
 * the shape rather than of a conditional somebody has to remember.
 */
export interface SettingsContext {
  /** The active project. */
  projectId: number;
  /** The project as the server last returned it. */
  project: Project;
  /** The MCP endpoint, which only the MCP section renders. */
  mcp: Mcp | null;
  /** The caller's standing, as `project:view` decided it. */
  standing: ProjectStanding;
  /**
   * `can()` bound to this project's standing.
   *
   * The "until `project:view` answers, assume the least" fallback lives here and
   * nowhere else, so there is one copy of the rule — and the shell holds the
   * context back until `project:view` *has* answered, so by the time a section
   * calls this it is real standing rather than the pessimistic default.
   */
  may: (actionName: string) => boolean;
  /** Re-read `project:view` alone. */
  reloadProject: () => Promise<void>;
  /**
   * Tell the shell whether this section is holding unsaved edits.
   *
   * A section must clear it after a successful save and on unmount. Which sections
   * report at all is a judgement, and the list is in `SettingsPage`'s JSDoc.
   */
  markDirty: (slug: string, dirty: boolean) => void;
}

/**
 * The settings context, typed.
 *
 * The single seam: no section imports `useOutletContext` directly, so turning
 * this into a real context is a change to this file alone.
 * @returns What the shell provided.
 */
export function useProjectSettings(): SettingsContext {
  return useOutletContext<SettingsContext>();
}
