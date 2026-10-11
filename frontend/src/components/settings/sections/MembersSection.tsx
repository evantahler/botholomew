import type { MembershipList } from "@backend/actions/membership/membership-list";
import type { TagList } from "@backend/actions/tag/tag-list";
import type { ActionResponse } from "keryx";
import { useCallback, useEffect, useState } from "react";
import Badge from "#ui/Badge";
import Button from "#ui/Button";
import Dropdown from "#ui/Dropdown";
import Form from "#ui/Form";
import Table from "#ui/Table";
import { useAuth } from "../../../context/AuthContext";
import { useFirstLoad } from "../../../hooks/useFirstLoad";
import { apiFetch } from "../../../utils/client";
import SkeletonRows from "../../SkeletonRows";
import SectionCard from "../../sections/SectionCard";
import { useSectionSave } from "../../sections/useSectionSave";
import { useProjectSettings } from "../context";

/** One member with their tags, as `membership:list` serializes it. */
type Member = ActionResponse<MembershipList>["memberships"][number];

/** A tag as `tag:list` serializes it. */
type ProjectTag = ActionResponse<TagList>["tags"][number];

/**
 * Who is in the project, and which tags each of them holds.
 *
 * Adding somebody here requires them to already have an account; an invite by email
 * is what `/invites` is for, and the note at the bottom says so.
 * @returns The rendered section.
 */
export default function MembersSection() {
  const { projectId, standing, may } = useProjectSettings();
  const { user } = useAuth();
  const { busy, error, notice, setError, setNotice, save } = useSectionSave();
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const { loading, begin, done } = useFirstLoad();

  const load = useCallback(async () => {
    begin();
    try {
      const [memberships, tagList] = await Promise.all([
        apiFetch<ActionResponse<MembershipList>>(
          `/memberships?projectId=${projectId}&limit=100`,
        ),
        apiFetch<ActionResponse<TagList>>(
          `/tags?projectId=${projectId}&limit=100`,
        ),
      ]);
      setMembers(memberships.memberships);
      setTags(tagList.tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load members.");
    } finally {
      done();
    }
  }, [projectId, setError, begin, done]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Run one membership or tag change and re-read the table.
   * @param fn - The request.
   * @param success - What to say when it worked.
   * @returns Whether it worked, so a caller can clear its own field.
   */
  async function change(
    fn: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    const ok = await save(fn, success);
    if (ok) await load();
    return ok;
  }

  /**
   * The tags a member does not already hold, i.e. what can still be granted.
   * @param member - The member in question.
   * @returns The grantable tags.
   */
  const grantableTags = (member: Member) =>
    tags.filter((t) => !member.tags.some((mt) => mt.id === t.id));

  return (
    <SectionCard
      title="Members"
      testId="members"
      idPrefix="settings"
      cardTestId="members-card"
      error={error}
      notice={notice}
      onDismissError={() => setError(null)}
      onDismissNotice={() => setNotice(null)}
    >
      <Table hover responsive size="sm" data-testid="members-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Tags</th>
            {standing.isAdmin && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {/* The column count follows the header's own `standing.isAdmin`
              conditional above, or the ghost renders ragged under it. */}
          {loading && (
            <SkeletonRows
              columns={standing.isAdmin ? 4 : 3}
              rows={4}
              testId="members-skeleton"
              label="Loading members"
            />
          )}
          {!loading &&
            members.map((m) => (
              <tr key={m.id}>
                <td>{m.user.name}</td>
                <td>{m.user.email}</td>
                <td>
                  <div className="d-flex flex-wrap gap-1">
                    {m.tags.map((t) => (
                      <Badge
                        key={t.id}
                        pill
                        bg={t.reserved ? "warning" : "info"}
                        className="d-inline-flex align-items-center gap-1"
                      >
                        {t.name}
                        {may("user-tag:remove") && (
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 lh-1"
                            disabled={busy}
                            aria-label={`Revoke ${t.name} from ${m.user.name}`}
                            onClick={() =>
                              change(
                                () =>
                                  apiFetch("/user-tag", {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      projectId,
                                      userId: m.userId,
                                      tagId: t.id,
                                    }),
                                  }),
                                `Revoked ${t.name} from ${m.user.name}.`,
                              )
                            }
                          >
                            ×
                          </Button>
                        )}
                      </Badge>
                    ))}
                    {m.tags.length === 0 && <span className="bh-muted">—</span>}
                  </div>
                </td>
                {standing.isAdmin && (
                  <td>
                    <div className="d-inline-flex gap-2">
                      {may("user-tag:assign") &&
                        grantableTags(m).length > 0 && (
                          <Dropdown>
                            <Dropdown.Toggle size="sm" variant="outline-info">
                              Grant tag
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              {grantableTags(m).map((t) => (
                                <Dropdown.Item
                                  key={t.id}
                                  onClick={() =>
                                    change(
                                      () =>
                                        apiFetch("/user-tag", {
                                          method: "PUT",
                                          body: JSON.stringify({
                                            projectId,
                                            userId: m.userId,
                                            tagId: t.id,
                                          }),
                                        }),
                                      `Granted ${t.name} to ${m.user.name}.`,
                                    )
                                  }
                                >
                                  {t.name}
                                </Dropdown.Item>
                              ))}
                            </Dropdown.Menu>
                          </Dropdown>
                        )}
                      {may("membership:delete") && m.userId !== user?.id && (
                        <Button
                          size="sm"
                          variant="outline-danger"
                          disabled={busy}
                          onClick={() =>
                            change(
                              () =>
                                apiFetch("/membership", {
                                  method: "DELETE",
                                  body: JSON.stringify({
                                    projectId,
                                    userId: m.userId,
                                  }),
                                }),
                              `Removed ${m.user.name}.`,
                            )
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </Table>

      {may("membership:create") && (
        <Form
          className="d-flex gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const email = newMemberEmail.trim();
            if (!email) return;
            // Cleared only on success, so a refused email can be corrected
            // rather than retyped.
            change(
              () =>
                apiFetch("/membership", {
                  method: "PUT",
                  body: JSON.stringify({ projectId, email }),
                }),
              `Added ${email}.`,
            ).then((ok) => {
              if (ok) setNewMemberEmail("");
            });
          }}
        >
          <Form.Label visuallyHidden htmlFor="new-member-email">
            Email of an existing user
          </Form.Label>
          <Form.Control
            id="new-member-email"
            size="sm"
            type="email"
            className="w-auto"
            placeholder="Existing user's email"
            value={newMemberEmail}
            disabled={busy}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            data-testid="new-member-email"
          />
          <Button
            size="sm"
            type="submit"
            variant="outline-primary"
            disabled={busy}
            data-testid="new-member-submit"
          >
            Add member
          </Button>
        </Form>
      )}
      <p className="bh-mono-label mt-2 mb-0">
        To add someone without an account, invite them by email.
      </p>
    </SectionCard>
  );
}
