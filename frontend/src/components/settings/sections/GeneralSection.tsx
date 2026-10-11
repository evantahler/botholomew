import { useEffect } from "react";
import Form from "#ui/Form";
import { useAuth } from "../../../context/AuthContext";
import { apiFetch } from "../../../utils/client";
import SectionCard from "../../sections/SectionCard";
import { useSectionSave } from "../../sections/useSectionSave";
import { useSeededDraft } from "../../sections/useSeededDraft";
import { useProjectSettings } from "../context";

/**
 * The project's name — the landing section, and the one thing about a project
 * every member can see and an admin can change.
 * @returns The rendered section.
 */
export default function GeneralSection() {
  const { projectId, project, may, reloadProject, markDirty } =
    useProjectSettings();
  const { refresh } = useAuth();
  const { busy, error, notice, setError, setNotice, save } = useSectionSave();
  const mayEdit = may("project:edit");

  const { draft, update, edited, markSaved } = useSeededDraft(
    () => ({ name: project.name }),
    [project],
  );

  useEffect(() => {
    markDirty("general", edited);
    return () => markDirty("general", false);
  }, [edited, markDirty]);

  /** Rename the project, then re-hydrate so the navbar switcher agrees. */
  async function onSave() {
    const ok = await save(
      () =>
        apiFetch("/project", {
          method: "POST",
          body: JSON.stringify({ projectId, name: draft.name.trim() }),
        }),
      "Project renamed.",
    );
    // `markSaved` only on success and before the reload, the rule
    // `useSeededDraft` documents: on a refused name the field keeps what was
    // typed and the sidebar keeps its marker.
    if (!ok) return;
    markSaved();
    // `refresh()` first and awaited: the navbar's switcher reads `AuthContext`,
    // not this page, so without it the project is renamed everywhere except the
    // one place the user is looking.
    await refresh();
    await reloadProject();
  }

  const trimmed = draft.name.trim();

  return (
    <SectionCard
      title="Name"
      testId="general"
      idPrefix="settings"
      cardTestId="project-name-card"
      error={error}
      notice={notice}
      onDismissError={() => setError(null)}
      onDismissNotice={() => setNotice(null)}
      onSave={mayEdit ? onSave : undefined}
      saveLabel="Rename"
      canSave={trimmed !== "" && trimmed !== project.name}
      busy={busy}
    >
      {mayEdit ? (
        <Form.Group controlId="project-name">
          <Form.Label className="bh-mono-label">Project name</Form.Label>
          <Form.Control
            value={draft.name}
            disabled={busy}
            onChange={(e) => update({ name: e.target.value })}
            data-testid="project-name"
          />
          <Form.Text className="bh-muted">
            Shown in the switcher, invites, and the top of this page — not an
            identifier.
          </Form.Text>
        </Form.Group>
      ) : (
        <span data-testid="project-name-readonly">{project.name}</span>
      )}
    </SectionCard>
  );
}
