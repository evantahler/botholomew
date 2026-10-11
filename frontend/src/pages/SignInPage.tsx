import type { SessionCreate } from "@backend/actions/session";
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
 * The sign-in form, wired to `session:create`. The backend answers a wrong password
 * and an unknown email identically, and this page passes that message through
 * unchanged rather than guessing which one it was.
 * @returns The rendered sign-in page.
 */
export default function SignInPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Validate, sign in, hydrate the session, and land on the project page.
   * @param event - The form's submit event.
   */
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.includes("@")) return setError("Enter a valid email address.");
    if (password.length < 8) {
      return setError("Passwords are at least 8 characters.");
    }
    setError(null);
    setSubmitting(true);

    try {
      await apiFetch<ActionResponse<SessionCreate>>("/session", {
        method: "PUT",
        body: JSON.stringify({ email, password }),
      });
      // Hydrate before navigating, so the route guard sees a user and the navbar
      // has the project list on first paint.
      await refresh();
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="bh-auth-card" data-testid="sign-in-card">
      <Card.Header as="h1">Sign in</Card.Header>
      <Card.Body>
        {error && (
          <Alert variant="danger" data-testid="form-error">
            {error}
          </Alert>
        )}
        <Form onSubmit={onSubmit} noValidate>
          <Form.Group className="mb-2" controlId="sign-in-email">
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
          <Form.Group className="mb-3" controlId="sign-in-password">
            <Form.Label>Password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="password"
              required
            />
          </Form.Group>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            data-testid="submit"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </Form>
      </Card.Body>
      <Card.Footer className="bh-muted">
        No account?{" "}
        <Link to="/sign-up" data-testid="sign-up-link-from-sign-in">
          Sign up
        </Link>
      </Card.Footer>
    </Card>
  );
}
