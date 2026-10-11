import { Link } from "react-router-dom";
import Card from "#ui/Card";
import Col from "#ui/Col";
import Container from "#ui/Container";
import Row from "#ui/Row";
import { V1_BRANCH_URL } from "../../components/Layout";
import { useAuth } from "../../context/AuthContext";

/**
 * What Botholomew 2.0 is, as designed. Every card here is in development, and
 * the section that renders them says so in its heading — nothing on this list
 * is something a visitor can use today.
 */
const DESIGN = [
  {
    name: "A team of bots",
    body: "Every project has a leader bot and any number of workers. Each has its own prompts, identity, and goals, and the leader hands work to the others.",
  },
  {
    name: "Always on",
    body: "Bots hibernate when idle and wake when a person, another bot, a schedule, or an event gives them something to do.",
  },
  {
    name: "Shared by the project",
    body: "Bots share the project's memory — a versioned filesystem with search — its MCP servers, and its skills.",
  },
  {
    name: "Wherever you are",
    body: "Talk to your bots from the website, the CLI and its TUI, Slack, and iMessage.",
  },
];

/**
 * What works today: the platform the bots are being built on. Kept to what the
 * shell actually does, because a marketing page that claims an unbuilt feature
 * is the one claim a reader cannot check before they sign up.
 */
const BUILT = [
  {
    name: "Projects and teams",
    body: "Sign up and land in your own project as its admin. Invite teammates by email, and grant them tags; the reserved admin tag is what makes someone an administrator.",
  },
  {
    name: "An audit log",
    body: "Every change a person makes to a project is recorded with what it looked like before and after, in the same transaction as the change.",
  },
  {
    name: "MCP for your assistant",
    body: "Connect Claude or another MCP client with OAuth, and it can manage your projects, members, tags, and invites as you.",
  },
  {
    name: "A command line",
    body: "The botholomew CLI talks to the same API as this website: sign in, switch projects, and manage tags, members, invites, and the audit log from a shell.",
  },
];

/**
 * The hero's call to action, which follows the session rather than assuming a
 * stranger. Asking a signed-in user to sign in is the whole bug: the navbar
 * above already carries their name, their project switcher, and every
 * session-only route.
 *
 * Unlike the navbar — which renders its signed-out shape during hydration and
 * swaps — this consumes `loading` and renders an empty row. A menu label
 * flipping is nothing; a full-width "Get started" flashing underneath a signed-in
 * user's own name is the bug arriving 200ms late. `.bh-hero-cta` reserves the
 * height so the sections below do not jump when the session resolves.
 *
 * These are real router links so middle-click and other native navigation
 * behavior work; the local component layer also styles their semantic classes.
 * @returns The rendered call-to-action row.
 */
function HeroCta() {
  const { user, projects, activeProjectId, loading } = useAuth();

  /**
   * The links for the current session state.
   * @returns The links, or `null` while the session is still hydrating.
   */
  function links() {
    if (loading) return null;

    if (!user) {
      return (
        <>
          <Link to="/sign-up" className="btn btn-primary">
            Get started
          </Link>
          <Link to="/sign-in" className="btn btn-outline-secondary">
            Sign in
          </Link>
        </>
      );
    }

    if (projects.length === 0) {
      return (
        <Link to="/projects/new" className="btn btn-primary">
          Create a project
        </Link>
      );
    }

    // The same lookup the navbar's switcher does, but the fallback is a project
    // rather than a label — this branch only runs when there is one.
    const project =
      projects.find((p) => p.id === activeProjectId) ?? projects[0];

    return (
      <>
        <Link to="/home" className="btn btn-primary">
          Go to {project.name}
        </Link>
        <Link to="/settings" className="btn btn-outline-secondary">
          Settings
        </Link>
      </>
    );
  }

  return (
    <div className="d-flex gap-2 mt-3 bh-hero-cta" data-testid="hero-cta">
      {links()}
    </div>
  );
}

/**
 * The marketing landing page: what Botholomew 2.0 is, clearly labelled as in
 * development; what works today; a real CLI session; and where v1 lives.
 *
 * The split between the two card sections is the point of the page. "Designed"
 * describes the product as planned and says so in its heading; "Works today"
 * names only what the shell does.
 * @returns The rendered landing page.
 */
export default function HomePage() {
  return (
    <>
      <Container className="bh-hero">
        <p className="bh-kicker" data-testid="in-development">
          Botholomew 2.0 · in development
        </p>
        <h1 className="bh-wordmark">Botholomew</h1>
        {/* `.bh-cursor` appends the blinking block caret in CSS. */}
        <p className="bh-tagline bh-cursor">
          Always-on bot swarms for your team.&nbsp;
        </p>
        <p className="bh-lead">
          Botholomew 2.0 is a cloud service of always-on bot swarms: every
          project gets a leader bot and a team of workers that share the
          project&apos;s memory, MCP servers, and skills, and that people reach
          from the web, the CLI, Slack, and iMessage. It is in development. What
          runs today is the platform underneath — accounts, projects, teams, an
          audit log, MCP, and the CLI. No bot is built yet.
        </p>
        <HeroCta />
        <p className="bh-muted mt-3 mb-0">
          <Link to="/docs">Docs</Link>
          {" · "}
          <Link to="/docs/cli">CLI</Link>
          {" · "}
          {/* A plain `<a>`: this leaves the app. */}
          <a
            href={V1_BRANCH_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="v1-link"
          >
            Botholomew v1, the local agent
          </a>
        </p>
      </Container>

      <Container>
        <span className="bh-rule" aria-hidden="true" />
        <h2 className="bh-section-title">Designed, in development</h2>
        <p className="bh-lead">
          What Botholomew 2.0 is for. None of this is built yet.
        </p>
        <Row className="g-3" data-testid="design-cards">
          {DESIGN.map((item) => (
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
      </Container>

      <Container className="mt-4">
        <span className="bh-rule" aria-hidden="true" />
        <h2 className="bh-section-title">Works today</h2>
        <Row className="g-3" data-testid="built-cards">
          {BUILT.map((item) => (
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
      </Container>

      <Container className="mt-4">
        <span className="bh-rule" aria-hidden="true" />
        <h2 className="bh-section-title">From a shell</h2>
        <p className="bh-lead">
          The <Link to="/docs/cli">botholomew CLI</Link> is the same session as
          the website. Run it from a checkout of the repository as{" "}
          <code>bun run --cwd cli botholomew</code>.
        </p>
        <div className="terminal-block" data-testid="cli-terminal-block">
          <div className="terminal-block-bar">cli · botholomew</div>
          <pre className="terminal-block-body">
            <div className="bh-in">
              {
                "botholomew login --email you@example.com --password '$BOTHOLOMEW_PASSWORD'"
              }
            </div>
            <div className="bh-in">botholomew project list</div>
            <div className="bh-in">botholomew tag create --name operators</div>
            <div className="bh-in">
              botholomew invite create --email mario@example.com --tag operators
            </div>
            <div className="bh-in">botholomew audit list --json</div>
          </pre>
        </div>
      </Container>
    </>
  );
}
