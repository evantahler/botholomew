import type { ProjectView } from "@backend/actions/project/project-view";
import type { ActionResponse } from "keryx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import Alert from "#ui/Alert";
import Col from "#ui/Col";
import Row from "#ui/Row";
import LoadingLabel from "../components/LoadingLabel";
import DiscardChangesModal from "../components/sections/DiscardChangesModal";
import { useDirtyGuard } from "../components/sections/useDirtyGuard";
import type {
  Mcp,
  Project,
  SettingsContext,
} from "../components/settings/context";
import SettingsSectionNav from "../components/settings/SettingsSectionNav";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../utils/client";
import { can, type ProjectStanding } from "../utils/permissions";

/**
 * The standing to assume before `project:view` answers.
 *
 * A module constant rather than an inline literal, so `may`'s identity does not
 * change on every render — a fresh object in a `useCallback` dependency list would
 * rebuild it continuously and re-fire every effect a section keys on it.
 */
const NOT_A_MEMBER: ProjectStanding = { isMember: false, isAdmin: false };

/**
 * `/settings/*` — the project settings shell: section sidebar, and the section
 * itself.
 *
 * Each section owns its own card, draft, and alerts, so a section's error
 * renders beside the control that caused it, and a background refresh cannot
 * revert what somebody is typing — `useSeededDraft` is what guarantees the
 * second.
 *
 * **One loader, and the shell holds only what more than one simultaneously
 * reachable section needs.** `project:view` is the only source of standing, so
 * the outlet context stays `null` until it answers. Everything else a single
 * section reads, that section fetches, which is what makes "a plain member never
 * calls an admin-only endpoint" a property of the shape rather than of a
 * conditional somebody has to remember.
 *
 * **Which sections report unsaved edits**, so the next reader does not add a
 * second without deciding to: General (the rename). Deliberately not MCP, which
 * has nothing to type; not Tags or Members, where the draft is a ten-character
 * name typed immediately before submitting and a modal in front of that is worse
 * than retyping it; and not Danger zone, where losing the confirmation text is
 * the *point* of asking for it.
 * @returns The rendered settings area.
 */
export default function SettingsPage() {
  const { activeProjectId, permissions } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [mcp, setMcp] = useState<Mcp | null>(null);
  const [standing, setStanding] = useState<ProjectStanding | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    dirtySlug,
    markDirty,
    onNavigate,
    pendingNav,
    cancelNav,
    confirmNav,
  } = useDirtyGuard("/settings");

  /** Re-read `project:view` alone: the project, the caller's standing, the MCP URL. */
  const reloadProject = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const view = await apiFetch<ActionResponse<ProjectView>>(
        `/project?projectId=${activeProjectId}`,
      );
      setProject(view.project);
      setMcp(view.mcp);
      setStanding(view.standing);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load this project.",
      );
    }
  }, [activeProjectId]);

  useEffect(() => {
    reloadProject();
  }, [reloadProject]);

  // Until `project:view` answers, assume the least — flashing admin controls on
  // and back off again is worse than a beat of nothing. The context is withheld
  // until then, so no section ever sees this fallback; it exists so `may` is a
  // stable function rather than a nullable one.
  const may = useCallback(
    (actionName: string) =>
      can(permissions, actionName, standing ?? NOT_A_MEMBER),
    [permissions, standing],
  );

  // Memoized on its actual members: the object's identity would otherwise change
  // on every render of this component, re-firing any effect a section has that
  // depends on it.
  const outletContext: SettingsContext | null = useMemo(
    () =>
      activeProjectId && project && standing
        ? {
            projectId: activeProjectId,
            project,
            mcp,
            standing,
            may,
            reloadProject,
            markDirty,
          }
        : null,
    [activeProjectId, project, mcp, standing, may, reloadProject, markDirty],
  );

  if (!activeProjectId) {
    return (
      <Alert variant="info" className="mt-3" data-testid="no-project">
        Select or create a project to change its settings.
      </Alert>
    );
  }

  return (
    <>
      <h1 className="mt-3">{project?.name ?? "Settings"}</h1>
      <span className="bh-rule" aria-hidden="true" />

      {/* The shell's own failures only. Everything a section does reports inside
          that section's card, which is the whole reason for the section
          shape. */}
      {error && (
        <Alert
          variant="danger"
          dismissible
          onClose={() => setError(null)}
          data-testid="settings-error"
        >
          {error}
        </Alert>
      )}

      <Row className="g-3">
        <Col md={3}>
          {/* Rendered before the project resolves, so the sidebar is there to
              click on during the first fetch rather than appearing under the
              cursor a moment later. */}
          <SettingsSectionNav dirtySlug={dirtySlug} onNavigate={onNavigate} />
        </Col>
        <Col md={9}>
          {/* `!error` rather than `{error ?? "Loading…"}`, which renders a
              failure under a testid that says "loading" — so a read that threw
              looks, to anything watching that locator, exactly like one still
              in flight. The message itself is not repeated here: the shell's
              own Alert above already carries it, and a second element wearing
              `settings-error` is a duplicate test id, which Playwright's strict
              mode refuses outright. */}
          {outletContext ? (
            <Outlet context={outletContext} />
          ) : (
            !error && <LoadingLabel testId="settings-loading" />
          )}
        </Col>
      </Row>

      <DiscardChangesModal
        dirtySlug={dirtySlug}
        pendingNav={pendingNav}
        onCancel={cancelNav}
        onConfirm={confirmNav}
      />
    </>
  );
}
