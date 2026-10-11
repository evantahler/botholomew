import type { TagList } from "@backend/actions/tag/tag-list";
import type { ActionResponse } from "keryx";
import { useCallback, useEffect, useState } from "react";
import Badge from "#ui/Badge";
import Button from "#ui/Button";
import Form from "#ui/Form";
import { useFirstLoad } from "../../../hooks/useFirstLoad";
import { apiFetch } from "../../../utils/client";
import SkeletonBlocks from "../../SkeletonBlocks";
import SectionCard from "../../sections/SectionCard";
import { useSectionSave } from "../../sections/useSectionSave";
import { useProjectSettings } from "../context";

/** A tag as `tag:list` serializes it, `reserved` included. */
type ProjectTag = ActionResponse<TagList>["tags"][number];

/**
 * The project's tags: the reserved `admin` tag, which is what makes a member an
 * administrator, and any others an admin creates to label members.
 *
 * It fetches its own tag list rather than reading one off the shell, and so does
 * Members — exactly one of the two is ever mounted, so there is no duplicate
 * request and no cross-section reload to coordinate when a tag is deleted.
 * @returns The rendered section.
 */
export default function TagsSection() {
  const { projectId, may } = useProjectSettings();
  const { busy, error, notice, setError, setNotice, save } = useSectionSave();
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const { loading, begin, done } = useFirstLoad();

  const load = useCallback(async () => {
    begin();
    try {
      setTags(
        (
          await apiFetch<ActionResponse<TagList>>(
            `/tags?projectId=${projectId}&limit=100`,
          )
        ).tags,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tags.");
    } finally {
      done();
    }
  }, [projectId, setError, begin, done]);

  useEffect(() => {
    load();
  }, [load]);

  /** Create a tag. */
  async function onAdd() {
    const name = newTagName.trim();
    if (!name) return;
    const ok = await save(
      () =>
        apiFetch("/tag", {
          method: "PUT",
          body: JSON.stringify({ projectId, name }),
        }),
      `Added the ${name} tag.`,
    );
    if (!ok) return;
    setNewTagName("");
    await load();
  }

  /**
   * Delete a tag, revoking it from everyone who held it.
   * @param tag - The tag to delete.
   */
  async function onDelete(tag: ProjectTag) {
    const ok = await save(
      () =>
        apiFetch("/tag", {
          method: "DELETE",
          body: JSON.stringify({ projectId, tagId: tag.id }),
        }),
      `Deleted the ${tag.name} tag.`,
    );
    if (!ok) return;
    await load();
  }

  return (
    <SectionCard
      title="Tags"
      testId="tags"
      idPrefix="settings"
      cardTestId="tags-card"
      intro={
        <>
          Labels granted to members. The reserved <code>admin</code> tag grants
          administration of this project and cannot be deleted; every other tag
          is yours to name, grant, and revoke.
        </>
      }
      error={error}
      notice={notice}
      onDismissError={() => setError(null)}
      onDismissNotice={() => setNotice(null)}
    >
      {/* The `tag-list` div stays mounted throughout — the e2e suite asserts it
          visible with no text of its own, so an unmounted one is the single
          shape that fails outright. The placeholder goes inside it. */}
      <div className="d-flex flex-wrap gap-2 mb-3" data-testid="tag-list">
        {loading && (
          <SkeletonBlocks
            count={1}
            testId="tags-skeleton"
            label="Loading tags"
          />
        )}
        {!loading &&
          tags.map((t) => (
            <Badge
              key={t.id}
              pill
              bg={t.reserved ? "warning" : "secondary"}
              className="d-inline-flex align-items-center gap-2"
            >
              {t.name}
              {/* The reserved tag has no delete affordance — the backend refuses
                it, so offering the control would only teach the user that the UI
                lies. */}
              {may("tag:delete") && !t.reserved && (
                <Button
                  size="sm"
                  variant="link"
                  className="p-0 lh-1"
                  disabled={busy}
                  aria-label={`Delete the ${t.name} tag`}
                  onClick={() => onDelete(t)}
                >
                  ×
                </Button>
              )}
            </Badge>
          ))}
        {!loading && tags.length === 0 && (
          <span className="bh-muted" data-testid="no-tags">
            No tags yet.
          </span>
        )}
      </div>

      {may("tag:create") && (
        <Form
          className="d-flex gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <Form.Label visuallyHidden htmlFor="new-tag-name">
            New tag name
          </Form.Label>
          <Form.Control
            id="new-tag-name"
            size="sm"
            className="w-auto"
            placeholder="New tag"
            value={newTagName}
            disabled={busy}
            onChange={(e) => setNewTagName(e.target.value)}
            data-testid="new-tag-name"
          />
          <Button
            size="sm"
            type="submit"
            variant="outline-primary"
            disabled={busy}
            data-testid="new-tag-submit"
          >
            Add tag
          </Button>
        </Form>
      )}
    </SectionCard>
  );
}
