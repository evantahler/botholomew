import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "#ui/Alert";
import Button from "#ui/Button";
import Form from "#ui/Form";
import { useAuth } from "../../../context/AuthContext";
import { apiFetch } from "../../../utils/client";
import SectionCard from "../../sections/SectionCard";
import { useSectionSave } from "../../sections/useSectionSave";
import { useProjectSettings } from "../context";

/**
 * Deleting the project.
 *
 * The type-the-name confirmation is the whole control, which is why this section
 * deliberately does **not** report itself dirty: losing the confirmation text on
 * the way out is the point of asking for it, and a "discard unsaved changes?"
 * modal in front of a half-typed project name would be absurd.
 * @returns The rendered section.
 */
export default function DangerZoneSection() {
  const { projectId, project, may } = useProjectSettings();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const { busy, error, notice, setError, setNotice, save } = useSectionSave();
  const [confirmText, setConfirmText] = useState("");
  const mayDelete = may("project:delete");

  /** Delete the project, re-hydrate, and let the guard route onward. */
  async function onDelete() {
    const ok = await save(
      () =>
        apiFetch("/project", {
          method: "DELETE",
          body: JSON.stringify({ projectId }),
        }),
      "Project deleted.",
    );
    if (!ok) return;
    // `refresh()` awaited *before* navigating, so `AuthContext` has already
    // self-healed `activeProjectId` onto a surviving project. Reloading this
    // project instead reads a row that is gone and flashes a 403 at somebody
    // who just deleted it deliberately.
    await refresh();
    navigate("/settings");
  }

  return (
    <SectionCard
      title="Danger zone"
      testId="danger"
      idPrefix="settings"
      // The card carries `danger-card` only when the controls are actually
      // here. A guest must find no `danger-card` at all — that absence is what
      // the tenancy spec asserts — while still getting a section that explains
      // itself rather than an empty box.
      cardTestId={mayDelete ? "danger-card" : undefined}
      error={error}
      notice={notice}
      onDismissError={() => setError(null)}
      onDismissNotice={() => setNotice(null)}
    >
      {mayDelete ? (
        <>
          <p className="bh-muted">
            Deleting this project also deletes its tags, memberships, and
            invites. This cannot be undone. Type <code>{project.name}</code> to
            confirm.
          </p>
          <div className="d-flex gap-2 flex-wrap">
            <Form.Label visuallyHidden htmlFor="delete-project-name">
              Project name, to confirm
            </Form.Label>
            <Form.Control
              id="delete-project-name"
              size="sm"
              className="w-auto"
              placeholder={project.name}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              data-testid="delete-project-name"
            />
            <Button
              size="sm"
              variant="danger"
              disabled={busy || confirmText !== project.name}
              onClick={onDelete}
              data-testid="delete-project-confirm"
            >
              Delete project
            </Button>
          </div>
        </>
      ) : (
        <Alert variant="info" className="mb-0" data-testid="danger-admin-only">
          Only project admins can delete a project.
        </Alert>
      )}
    </SectionCard>
  );
}
