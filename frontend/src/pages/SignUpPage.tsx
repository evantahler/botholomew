import type { UserCreate } from "@backend/actions/user";
import type { ActionResponse } from "keryx";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Alert from "#ui/Alert";
import Button from "#ui/Button";
import Card from "#ui/Card";
import Form from "#ui/Form";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../utils/client";

/**
 * The sign-up form, wired to `user:create`. Creating the account does not create a
 * session, so this immediately signs in with the same credentials — a new user
 * should land inside the app, not on a login form.
 * @returns The rendered sign-up page.
 */
export default function SignUpPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Validate, create the account, sign in, hydrate, and land on the project the
   * signup bootstrap just created.
   * @param event - The form's submit event.
   */
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim().length < 3) {
      return setError("Names are at least 3 characters.");
    }
    if (!email.includes("@")) return setError("Enter a valid email address.");
    if (password.length < 8) {
      return setError("Passwords are at least 8 characters.");
    }
    if (password !== confirm) return setError("The passwords do not match.");
    setError(null);
    setSubmitting(true);

    try {
      await apiFetch<ActionResponse<UserCreate>>("/user", {
        method: "PUT",
        body: JSON.stringify({ name: name.trim(), email, password }),
      });
      await apiFetch("/session", {
        method: "PUT",
        body: JSON.stringify({ email, password }),
      });
      await refresh();
      navigate("/home");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create your account.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="bh-auth-card" data-testid="sign-up-card">
      <Card.Header as="h1">Sign up</Card.Header>
      <Card.Body>
        {error && (
          <Alert variant="danger" data-testid="form-error">
            {error}
          </Alert>
        )}
        <Form onSubmit={onSubmit} noValidate>
          <Form.Group className="mb-2" controlId="sign-up-name">
            <Form.Label>Name</Form.Label>
            <Form.Control
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="name"
              required
            />
          </Form.Group>
          <Form.Group className="mb-2" controlId="sign-up-email">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="email"
              required
            />
          </Form.Group>
          <Form.Group className="mb-2" controlId="sign-up-password">
            <Form.Label>Password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="password"
              required
            />
            <Form.Text>At least 8 characters.</Form.Text>
          </Form.Group>
          <Form.Group className="mb-3" controlId="sign-up-confirm">
            <Form.Label>Confirm password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="confirm"
              required
            />
          </Form.Group>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            data-testid="submit"
          >
            {submitting ? "Creating…" : "Create account"}
          </Button>
        </Form>
      </Card.Body>
      <Card.Footer className="bh-muted">
        Already have an account?{" "}
        <Link to="/sign-in" data-testid="sign-in-link-from-sign-up">
          Sign in
        </Link>
      </Card.Footer>
    </Card>
  );
}
