import type { UserEdit } from "@backend/actions/user-edit";
import type { ActionResponse } from "keryx";
import { type FormEvent, useState } from "react";
import Alert from "#ui/Alert";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Form from "#ui/Form";
import LoadingLabel from "../components/LoadingLabel";
import { useSeededDraft } from "../components/sections/useSeededDraft";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../utils/client";

/**
 * `/account` — edit your own name, email, or password through `user:edit`.
 * Only profile fields that actually changed are sent, so
 * submitting an untouched form does not re-hash a password or trip the
 * email-uniqueness check against yourself.
 * @returns The rendered page.
 */
export default function AccountPage() {
  const { user, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Name and email, seeded from the session and **only while untouched**.
   *
   * This replaced a `useEffect(() => { setName(user.name); … }, [user])`, which
   * is the pattern {@link useSeededDraft}'s own JSDoc forbids by name. It looked
   * benign because a successful save makes the fields equal already — but
   * `refresh()` is called from the project switcher and from accepting an
   * invite, so a session re-read landing between two keystrokes reverted what
   * was being typed. That is the twenty-six-clicks bug, in the one file the
   * editor refactor never reached.
   *
   * The password is deliberately **not** in here: it is never seeded from the
   * server, and a draft that re-seeded it would have somewhere to put one.
   */
  const { draft, update, markSaved } = useSeededDraft(
    () => ({ name: user?.name ?? "", email: user?.email ?? "" }),
    [user],
  );

  /**
   * Submit only the changed fields, then re-hydrate so the navbar updates.
   * @param event - The form's submit event.
   */
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const body: { name?: string; email?: string; password?: string } = {};
    const trimmedName = draft.name.trim();
    const trimmedEmail = draft.email.trim();
    if (user && trimmedName !== user.name) body.name = trimmedName;
    if (user && trimmedEmail.toLowerCase() !== user.email) {
      body.email = trimmedEmail;
    }
    if (password) body.password = password;

    if (Object.keys(body).length === 0) {
      return setError("Nothing to update.");
    }
    if (body.password !== undefined && body.password.length < 8) {
      return setError("Passwords are at least 8 characters.");
    }

    try {
      // Before the request, not after: `refresh()` below re-reads the session,
      // and that read is supposed to win. See `SeededDraft.markSaved`.
      markSaved();
      await apiFetch<ActionResponse<UserEdit>>("/user", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setPassword("");
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update your account.",
      );
    }
  }

  if (!user) {
    // The form is not rendered from a seed built out of `null`. Two empty inputs
    // labelled Name and Email are not a loading state — they are an account with
    // no name, which is a different and wrong claim, and a fast typist could
    // have submitted one.
    return (
      <>
        <h1 className="mt-3">Account</h1>
        <span className="bh-rule" aria-hidden="true" />
        <LoadingLabel testId="account-loading" />
      </>
    );
  }

  return (
    <>
      <h1 className="mt-3">Account</h1>
      <span className="bh-rule" aria-hidden="true" />

      <Card className="bh-auth-card" data-testid="account-card">
        <Card.Header as="h2">Profile</Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" data-testid="form-error">
              {error}
            </Alert>
          )}
          {saved && (
            <Alert variant="success" data-testid="form-saved">
              Your account has been updated.
            </Alert>
          )}
          <Form onSubmit={onSubmit} noValidate>
            <Form.Group className="mb-2" controlId="account-name">
              <Form.Label>Name</Form.Label>
              <Form.Control
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                data-testid="account-name"
              />
            </Form.Group>
            <Form.Group className="mb-2" controlId="account-email">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={(e) => update({ email: e.target.value })}
                data-testid="account-email"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="account-password">
              <Form.Label>New password</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                placeholder="Leave blank to keep your current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="account-password"
              />
              <Form.Text>At least 8 characters.</Form.Text>
            </Form.Group>
            <Button
              type="submit"
              variant="primary"
              data-testid="account-submit"
            >
              Save changes
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </>
  );
}
