import type { InviteList } from "@backend/actions/invite/invite-list";
import type { InviteListPending } from "@backend/actions/invite/invite-list-pending";
import type { ProjectView } from "@backend/actions/project/project-view";
import type { TagList } from "@backend/actions/tag/tag-list";
import type { ActionResponse } from "keryx";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import Alert from "#ui/Alert";
import Badge from "#ui/Badge";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Form from "#ui/Form";
import ListGroup from "#ui/ListGroup";
import Table from "#ui/Table";
import SkeletonBlocks from "../components/SkeletonBlocks";
import SkeletonRows from "../components/SkeletonRows";
import { useAuth } from "../context/AuthContext";
import { useFirstLoad } from "../hooks/useFirstLoad";
import { apiFetch } from "../utils/client";
import { can } from "../utils/permissions";

type PendingInvite = ActionResponse<InviteListPending>["invites"][number];
type SentInvite = ActionResponse<InviteList>["invites"][number];
type InviteTag = ActionResponse<TagList>["tags"][number];
type Standing = ActionResponse<ProjectView>["standing"];

/**
 * `/invites` — the invitations addressed to you (accept or reject), and, for an
 * admin of the active project, the form to invite someone plus the log of every
 * invite that project has issued.
 *
 * No email is sent — an invite appears here for its recipient on their next
 * sign-in. Email delivery is not built yet.
 * @returns The rendered page.
 */
export default function InvitesPage() {
  const { activeProjectId, permissions, refresh } = useAuth();
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [tags, setTags] = useState<InviteTag[]>([]);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const { loading, begin, done } = useFirstLoad();

  // Standing is the server's answer (see `project:view`), not a tag-name guess —
  // and `standing !== null` rather than a `?? { isMember: false, … }` fallback,
  // which computes a denial out of an unasked question. Here that only hides the
  // admin half, but the spelling is the rule; `AuditLogPage` is where the same
  // fallback printed a refusal.
  const canInvite =
    standing !== null && can(permissions, "invite:create", standing);

  const loadPending = useCallback(async () => {
    const res = await apiFetch<ActionResponse<InviteListPending>>(
      "/invites/pending?limit=100",
    );
    setPending(res.invites);
  }, []);

  const loadProjectContext = useCallback(async () => {
    if (!activeProjectId) {
      setStanding(null);
      setTags([]);
      setSent([]);
      return;
    }

    const [view, t] = await Promise.all([
      apiFetch<ActionResponse<ProjectView>>(
        `/project?projectId=${activeProjectId}`,
      ),
      apiFetch<ActionResponse<TagList>>(
        `/tags?projectId=${activeProjectId}&limit=100`,
      ),
    ]);
    setStanding(view.standing);
    setTags(t.tags);

    // `invite:list` is admin-only, so only ask for it when the caller qualifies —
    // otherwise the page would show a 403 for something it chose to request.
    if (view.standing.isAdmin) {
      const list = await apiFetch<ActionResponse<InviteList>>(
        `/invites?projectId=${activeProjectId}&limit=100`,
      );
      setSent(list.invites);
    } else {
      setSent([]);
    }
  }, [activeProjectId]);

  const load = useCallback(async () => {
    begin();
    setError(null);
    try {
      await Promise.all([loadPending(), loadProjectContext()]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load your invites.",
      );
    } finally {
      done();
    }
  }, [loadPending, loadProjectContext, begin, done]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Accept or reject an invite addressed to the signed-in user.
   * @param inviteId - The invite to answer.
   * @param action - Which way to answer it.
   */
  async function respond(inviteId: number, action: "accept" | "reject") {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/invite/${action}`, {
        method: "POST",
        body: JSON.stringify({ inviteId }),
      });
      await loadPending();
      // Accepting creates a membership, so the project switcher needs to know.
      if (action === "accept") await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    }
  }

  /**
   * Send an invite to the active project with the selected tags.
   * @param event - The form's submit event.
   */
  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProjectId) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/invite", {
        method: "PUT",
        body: JSON.stringify({
          projectId: activeProjectId,
          inviteeEmail: email,
          tagIds: selectedTagIds,
        }),
      });
      setInviteEmail("");
      setSelectedTagIds([]);
      setNotice(
        `Invited ${email}. No email is sent — the invite appears on their Invites page the next time they sign in.`,
      );
      await loadProjectContext();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send that invite.",
      );
    }
  }

  return (
    <>
      <h1 className="mt-3">Invites</h1>
      <span className="bh-rule" aria-hidden="true" />

      {error && (
        <Alert
          variant="danger"
          dismissible
          onClose={() => setError(null)}
          data-testid="invites-error"
        >
          {error}
        </Alert>
      )}
      {notice && (
        <Alert
          variant="success"
          dismissible
          onClose={() => setNotice(null)}
          data-testid="invites-notice"
        >
          {notice}
        </Alert>
      )}

      <Card className="mb-4">
        <Card.Header as="h2">Pending for you</Card.Header>
        <ListGroup variant="flush" data-testid="pending-invites">
          {!loading &&
            pending.map((invite) => (
              <ListGroup.Item
                key={invite.id}
                className="d-flex justify-content-between align-items-center flex-wrap gap-2"
              >
                <span>
                  <strong>{invite.projectName}</strong>{" "}
                  <span className="bh-muted">
                    invited by {invite.inviterEmail}
                  </span>
                </span>
                <span className="d-flex gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => respond(invite.id, "accept")}
                    data-testid={`accept-invite-${invite.id}`}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => respond(invite.id, "reject")}
                    data-testid={`reject-invite-${invite.id}`}
                  >
                    Reject
                  </Button>
                </span>
              </ListGroup.Item>
            ))}
          {/* Inside the `ListGroup`, which keeps its `pending-invites` testid
              mounted throughout — the e2e suite asserts that locator visible. */}
          {loading && (
            <ListGroup.Item>
              <SkeletonBlocks
                count={2}
                testId="pending-invites-skeleton"
                label="Loading your invitations"
              />
            </ListGroup.Item>
          )}
          {!loading && pending.length === 0 && (
            <ListGroup.Item
              className="bh-muted"
              data-testid="no-pending-invites"
            >
              No pending invitations.
            </ListGroup.Item>
          )}
        </ListGroup>
      </Card>

      {canInvite && (
        <>
          <Card className="mb-4" data-testid="invite-form-card">
            <Card.Header as="h2">Invite someone</Card.Header>
            <Card.Body>
              <Form onSubmit={onInvite} noValidate>
                <Form.Group className="mb-3" controlId="invite-email">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    autoComplete="off"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    data-testid="invite-email"
                    required
                  />
                  <Form.Text>
                    They do not need an account yet — the invite waits for them.
                  </Form.Text>
                </Form.Group>

                {tags.filter((t) => !t.reserved).length > 0 && (
                  <Form.Group className="mb-3">
                    <Form.Label>Tags to grant on acceptance</Form.Label>
                    <div className="d-flex flex-wrap gap-3">
                      {tags
                        .filter((t) => !t.reserved)
                        .map((t) => (
                          <Form.Check
                            key={t.id}
                            type="checkbox"
                            id={`invite-tag-${t.id}`}
                            label={t.name}
                            checked={selectedTagIds.includes(t.id)}
                            onChange={(e) =>
                              setSelectedTagIds((ids) =>
                                e.target.checked
                                  ? [...ids, t.id]
                                  : ids.filter((id) => id !== t.id),
                              )
                            }
                          />
                        ))}
                    </div>
                  </Form.Group>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  data-testid="invite-submit"
                >
                  Send invite
                </Button>
              </Form>
            </Card.Body>
          </Card>

          <Card data-testid="sent-invites-card">
            <Card.Header as="h2">Invites this project has sent</Card.Header>
            <Card.Body>
              <Table hover responsive size="sm" data-testid="sent-invites">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Status</th>
                    <th scope="col">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <SkeletonRows
                      columns={3}
                      rows={3}
                      testId="sent-invites-skeleton"
                      label="Loading sent invites"
                    />
                  )}
                  {sent.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.inviteeEmail}</td>
                      <td>
                        <Badge
                          bg={
                            invite.status === "accepted"
                              ? "success"
                              : invite.status === "rejected"
                                ? "danger"
                                : "secondary"
                          }
                        >
                          {invite.status}
                        </Badge>
                      </td>
                      <td>{new Date(invite.expiresAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {!loading && sent.length === 0 && (
                    <tr>
                      <td colSpan={3} className="bh-muted">
                        None yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </>
      )}
    </>
  );
}
