import type { ProjectView } from "@backend/actions/project/project-view";
import type { ActionResponse } from "keryx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Alert from "#ui/Alert";
import Card from "#ui/Card";
import Col from "#ui/Col";
import Row from "#ui/Row";
import SkeletonBlocks from "../components/SkeletonBlocks";
import { useAuth } from "../context/AuthContext";
import { useFirstLoad } from "../hooks/useFirstLoad";
import { apiFetch } from "../utils/client";
import { can } from "../utils/permissions";

type View = ActionResponse<ProjectView>;

/**
 * What a project holds and what Botholomew does that the website cannot do
 * yet, named so the home page says it plainly rather than implying it. Each
 * entry is a sentence about the product as designed, labelled as in
 * development where it renders.
 */
export const IN_DEVELOPMENT = [
  {
    name: "Bots",
    body: "A leader bot and any number of workers per project, each with its own prompts, identity, and goals.",
  },
  {
    name: "Memory",
    body: "A shared, versioned filesystem for the project, with search across everything in it.",
  },
  {
    name: "Threads",
    body: "Conversations with your bots from the website, the CLI, Slack, and iMessage.",
  },
  {
    name: "MCP servers and skills",
    body: "Remote tools and reusable instructions every bot in the project can share.",
  },
] as const;

/**
 * `/home` — the active project's landing page.
 *
 * Botholomew's shell is what exists: the project, its people and tags, the
 * audit log, and an MCP endpoint for a person's own client. This page links to
 * each of those, and lists what is in development as exactly that — a page
 * that implied bots were one click away is the one thing a shell must never
 * render.
 *
 * Reads `project:view` for the name and the caller's standing, gated on the
 * project it started for: switching projects keeps this page mounted, and a
 * late answer for the project you left must not paint the one you opened.
 * @returns The rendered project home.
 */
export default function HomePage() {
  const { activeProjectId, permissions } = useAuth();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loading, begin, done } = useFirstLoad();
  const showing = useRef(activeProjectId);

  // Declared above the loader's effect so React runs it first: the gate below
  // compares against the project on screen, never the one a request began for.
  useEffect(() => {
    showing.current = activeProjectId;
    setView(null);
    setError(null);
  }, [activeProjectId]);

  /** Read the project on screen, discarding an answer for any other. */
  const load = useCallback(async () => {
    if (!activeProjectId) return;
    const mine = activeProjectId;
    begin();
    try {
      const next = await apiFetch<View>(`/project?projectId=${mine}`);
      if (showing.current === mine) setView(next);
    } catch (err) {
      if (showing.current === mine) {
        setError(
          err instanceof Error ? err.message : "Could not load this project.",
        );
      }
    } finally {
      if (showing.current === mine) done();
    }
  }, [activeProjectId, begin, done]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activeProjectId) {
    return (
      <Alert variant="info" className="mt-3" data-testid="no-project">
        Select or create a project to see its home.
      </Alert>
    );
  }

  if (view === null) {
    // Before the first answer, and again after a project switch nulls the
    // view while `loading` stays settled: the same state from a reader's side,
    // so it looks the same.
    return (
      <div className="mt-3">
        {error && (
          <Alert variant="danger" data-testid="home-error">
            {error}
          </Alert>
        )}
        {!error && (
          <SkeletonBlocks
            count={3}
            testId={loading ? "home-loading" : "home-switching"}
            label="Loading project home"
          />
        )}
      </div>
    );
  }

  const { project, standing } = view;
  const mayInvite = can(permissions, "invite:create", standing);
  const mayReadAudit = can(permissions, "audit:list", standing);

  return (
    <div className="mt-3" data-testid="project-home">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-3 bh-page-heading">
        <div>
          <h1>{project.name}</h1>
          <p className="bh-muted mb-0">
            {standing.isAdmin ? "You administer this project." : "Member"}
          </p>
        </div>
        <Link className="btn btn-outline-secondary" to="/settings">
          Settings
        </Link>
      </div>

      <Row className="g-3">
        <Col md={6}>
          <Card data-testid="home-team">
            <Card.Header as="h2">Your team</Card.Header>
            <Card.Body>
              <p className="bh-muted">
                Members, the tags they hold, and who administers the project.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link className="btn btn-primary" to="/settings/members">
                  Members
                </Link>
                <Link className="btn btn-outline-secondary" to="/settings/tags">
                  Tags
                </Link>
                {mayInvite && (
                  <Link className="btn btn-outline-secondary" to="/invites">
                    Invite someone
                  </Link>
                )}
                {mayReadAudit && (
                  <Link className="btn btn-outline-secondary" to="/audit">
                    Audit log
                  </Link>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card data-testid="home-mcp">
            <Card.Header as="h2">Your own assistant</Card.Header>
            <Card.Body>
              <p className="bh-muted">
                Connect Claude or another MCP client to manage your projects,
                members, tags, and invites as you.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link className="btn btn-outline-secondary" to="/settings/mcp">
                  MCP endpoint
                </Link>
                <Link className="btn btn-outline-secondary" to="/docs/mcp">
                  How it works
                </Link>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <span className="bh-rule" aria-hidden="true" />
      <h2 className="bh-section-title">In development</h2>
      <Alert variant="info" data-testid="home-in-development">
        Botholomew 2.0 is in development. Bots, memory, and everything they do
        are not built yet; this project is where they live when they are.
      </Alert>
      <Row className="g-3">
        {IN_DEVELOPMENT.map((item) => (
          <Col md={6} lg={3} key={item.name}>
            <Card className="bh-feature-card h-100">
              <Card.Body>
                <Card.Title as="h3">{item.name}</Card.Title>
                <Card.Text>{item.body}</Card.Text>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
