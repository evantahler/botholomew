import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import Container from "#ui/Container";
import Dropdown from "#ui/Dropdown";
import Nav from "#ui/Nav";
import Navbar from "#ui/Navbar";
import type { AuthProject, AuthUser } from "../context/AuthContext";
import { useAuth } from "../context/AuthContext";
import { apiReferenceUrl } from "../utils/client";

/** Where the v1 local CLI agent lives, permanently. */
export const V1_BRANCH_URL = "https://github.com/evantahler/botholomew/tree/v1";

interface BrandDestinationOptions {
  user: AuthUser | null;
  projects: AuthProject[];
  loading: boolean;
}

/**
 * The navbar brand follows the current session: public visitors stay on the
 * marketing page, signed-in users with no projects go to creation, and everyone
 * else lands on their project home.
 * @param options - The current auth state.
 * @returns The route the brand should navigate to.
 */
export function brandDestination({
  user,
  projects,
  loading,
}: BrandDestinationOptions): string {
  if (loading || !user) {
    return "/";
  }

  return projects.length === 0 ? "/projects/new" : "/home";
}

/**
 * The compact application chrome: product, project context, navigation, and
 * session controls.
 *
 * Both shells render it, so every `data-testid` in here is global: a second
 * element claiming one of these names on any page makes one locator resolve to
 * two things.
 * @returns The rendered navbar.
 */
export function AppNavbar() {
  const {
    user,
    projects,
    activeProjectId,
    loading,
    setActiveProject,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const brandTo = brandDestination({ user, projects, loading });

  /** Sign out, then land on the marketing page. */
  async function onSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    // Remounting on the path closes a collapsed phone menu on the destination.
    // Click bubbling on the Collapse is not enough: a NavLink can navigate
    // before that handler runs, so the open state would paint on the new page.
    <Navbar
      key={location.pathname}
      expand="md"
      className="bh-navbar"
      data-testid="navbar"
    >
      <Container>
        <Navbar.Brand as={Link} to={brandTo} data-testid="brand">
          <span className="bh-navbar-brand-mark" aria-hidden="true">
            {"{o,o}"}
          </span>
          <span>Botholomew</span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="bh-nav" data-testid="nav-toggle" />
        <Navbar.Collapse id="bh-nav">
          <Nav className="me-auto">
            <span className="bh-navbar-slash" aria-hidden="true">
              /
            </span>
            <Dropdown data-testid="project-switcher">
              <Dropdown.Toggle
                as={Nav.Link}
                id="bh-project-switcher"
                data-testid="project-switcher-toggle"
              >
                {activeProject?.name ?? "No project"}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Header>Projects</Dropdown.Header>
                {projects.map((project) => (
                  <Dropdown.Item
                    key={project.id}
                    active={project.id === activeProjectId}
                    onClick={() => {
                      setActiveProject(project.id);
                      navigate("/home");
                    }}
                    data-testid={`project-option-${project.id}`}
                  >
                    {project.name}
                  </Dropdown.Item>
                ))}
                {projects.length === 0 && (
                  <Dropdown.Item disabled>None yet</Dropdown.Item>
                )}
                {user && (
                  <>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      as={Link}
                      to="/projects/new"
                      data-testid="new-project-link"
                    >
                      New project
                    </Dropdown.Item>
                  </>
                )}
              </Dropdown.Menu>
            </Dropdown>
            {user && (
              <>
                <Nav.Link as={NavLink} to="/home" data-testid="home-link">
                  Home
                </Nav.Link>
                <Dropdown data-testid="project-menu">
                  <Dropdown.Toggle as={Nav.Link} id="bh-project-menu">
                    Project
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item
                      as={Link}
                      to="/settings"
                      data-testid="settings-link"
                    >
                      Settings
                    </Dropdown.Item>
                    <Dropdown.Item
                      as={Link}
                      to="/invites"
                      data-testid="invites-link"
                    >
                      Invites
                    </Dropdown.Item>
                    {/* Shown to every signed-in user rather than gated on
                        `can()`: the navbar has no project standing. The page
                        itself owns its admin gate. */}
                    <Dropdown.Item
                      as={Link}
                      to="/audit"
                      data-testid="audit-link"
                    >
                      Audit
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </>
            )}
            <Nav.Link as={NavLink} to="/docs" data-testid="docs-link">
              Docs
            </Nav.Link>
          </Nav>
          <Nav>
            <Dropdown align="end" data-testid="user-menu">
              <Dropdown.Toggle
                as={Nav.Link}
                id="bh-user-menu"
                data-testid="user-menu-toggle"
              >
                {user?.name ?? "Signed out"}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item
                  as={Link}
                  to="/sign-in"
                  disabled={!!user}
                  data-testid="sign-in"
                >
                  Sign in
                </Dropdown.Item>
                <Dropdown.Item
                  as={Link}
                  to="/sign-up"
                  disabled={!!user}
                  data-testid="sign-up"
                >
                  Sign up
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item
                  as={Link}
                  to="/account"
                  disabled={!user}
                  data-testid="account-link"
                >
                  Account
                </Dropdown.Item>
                <Dropdown.Item
                  as={Link}
                  to="/style-guide"
                  disabled={!user}
                  data-testid="style-guide-link"
                >
                  Style guide
                </Dropdown.Item>
                {/* A plain `<a>` rather than a router `Link`: the OpenAPI
                    document is served by the backend at its own origin, and it
                    needs no session. */}
                <Dropdown.Item
                  as="a"
                  href={apiReferenceUrl()}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="api-reference-link"
                >
                  API reference
                </Dropdown.Item>
                <Dropdown.Item as={Link} to="/status" data-testid="status-link">
                  Status
                </Dropdown.Item>
                <Dropdown.Item
                  onClick={onSignOut}
                  disabled={!user}
                  data-testid="sign-out"
                >
                  Sign out
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

/**
 * The footer, on every route because it belongs to the application rather than
 * to any page — which is why it lives in both shells and not in a marketing
 * section that a signed-in user never sees. It says the one thing every visitor
 * should know: Botholomew 2.0 is in development, and v1 is where it was.
 * @returns The rendered footer.
 */
function AppFooter() {
  return (
    <footer className="bh-footer" data-testid="footer">
      <Container>
        Botholomew 2.0 is in development.{" "}
        {/* A plain `<a>` rather than a router `Link`: this leaves the app.
            `rel="noreferrer"` covers `noopener` in every browser that
            still needs it. */}
        <a href={V1_BRANCH_URL} target="_blank" rel="noreferrer">
          The v1 local agent
        </a>{" "}
        lives on its own branch.
      </Container>
    </footer>
  );
}

/**
 * The app-page shell: navbar plus a width-constrained `Container`. Use this for
 * anything behind a session.
 * @param props.children - The page content.
 * @returns The rendered layout.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="bh-shell">
      <AppNavbar />
      <Container as="main" className="pb-5">
        {children}
      </Container>
      <AppFooter />
    </div>
  );
}

/**
 * The marketing shell: the same navbar, but the page owns its own containers so it
 * can run sections edge to edge.
 * @param props.children - The page content.
 * @returns The rendered layout.
 */
export function FullWidthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bh-shell">
      <AppNavbar />
      <main className="pb-5">{children}</main>
      <AppFooter />
    </div>
  );
}
