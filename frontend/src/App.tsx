import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Alert from "#ui/Alert";
import { FullWidthLayout, Layout } from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { DEFAULT_SETTINGS_SECTION } from "./components/settings/sections";
import DangerZoneSection from "./components/settings/sections/DangerZoneSection";
import GeneralSection from "./components/settings/sections/GeneralSection";
import McpSection from "./components/settings/sections/McpSection";
import MembersSection from "./components/settings/sections/MembersSection";
import TagsSection from "./components/settings/sections/TagsSection";
import { DEFAULT_DOCS_SECTION } from "./content/docs/sections";
import { AuthProvider } from "./context/AuthContext";
import { LiveSocketProvider } from "./context/LiveSocketContext";
import AccountPage from "./pages/AccountPage";
import AuditLogPage from "./pages/AuditLogPage";
import DocsArticle from "./pages/docs/DocsArticle";
import DocsPage from "./pages/docs/DocsPage";
import ProjectHomePage from "./pages/HomePage";
import InvitesPage from "./pages/InvitesPage";
import HomePage from "./pages/marketing/HomePage";
import NewProjectPage from "./pages/NewProjectPage";
import SettingsPage from "./pages/SettingsPage";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import StatusPage from "./pages/StatusPage";
import StyleGuidePage from "./pages/StyleGuidePage";
import ThemeProvider from "./theme/ThemeProvider";

/**
 * The catch-all route. Without it an unknown path renders an empty document —
 * no navbar, no way back — which reads as a broken deploy rather than a typo.
 * @returns The rendered not-found notice.
 */
function NotFoundPage() {
  return (
    <Alert variant="warning" className="mt-3" data-testid="not-found">
      No such page.
    </Alert>
  );
}

/**
 * The route table. Marketing pages get `FullWidthLayout` so they can run sections
 * edge to edge; everything else gets the width-constrained `Layout`.
 *
 * The whole tree sits inside `AuthProvider`, because the navbar needs the session
 * on every page — including the public ones, where it reads "Signed out".
 * Session-only pages nest under {@link ProtectedRoute}, which is the single place
 * that decides where a signed-out or project-less visitor goes.
 *
 * `/style-guide` is public so its fixtures never depend on project data; a
 * signed-in shortcut in the user menu keeps the development surface discoverable.
 * @returns The rendered application.
 */
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          {/* Inside AuthProvider because it needs the session and the active
            project. */}
          <LiveSocketProvider>
            <Routes>
              <Route
                path="/"
                element={
                  <FullWidthLayout>
                    <HomePage />
                  </FullWidthLayout>
                }
              />
              <Route
                path="/sign-in"
                element={
                  <Layout>
                    <SignInPage />
                  </Layout>
                }
              />
              <Route
                path="/sign-up"
                element={
                  <Layout>
                    <SignUpPage />
                  </Layout>
                }
              />
              <Route
                path="/status"
                element={
                  <Layout>
                    <StatusPage />
                  </Layout>
                }
              />
              {/* Public docs: markdown under `content/docs/`, readable signed-in
                or signed-out. Nested like settings so a typo keeps the sidebar. */}
              <Route
                path="/docs"
                element={
                  <Layout>
                    <DocsPage />
                  </Layout>
                }
              >
                <Route
                  index
                  element={<Navigate to={DEFAULT_DOCS_SECTION} replace />}
                />
                <Route path=":slug" element={<DocsArticle />} />
              </Route>
              <Route
                path="/style-guide"
                element={
                  <Layout>
                    <StyleGuidePage />
                  </Layout>
                }
              />

              <Route element={<ProtectedRoute />}>
                <Route
                  path="/home"
                  element={
                    <Layout>
                      <ProjectHomePage />
                    </Layout>
                  }
                />
                <Route
                  path="/projects/new"
                  element={
                    <Layout>
                      <NewProjectPage />
                    </Layout>
                  }
                />
                <Route
                  path="/invites"
                  element={
                    <Layout>
                      <InvitesPage />
                    </Layout>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <Layout>
                      <SettingsPage />
                    </Layout>
                  }
                >
                  {/* `replace` is load-bearing: the navbar's NavLink points at
                    `/settings`, so without it Back returns here and the
                    redirect fires again — a Back-button trap that reads as Back
                    being broken. */}
                  <Route
                    index
                    element={<Navigate to={DEFAULT_SETTINGS_SECTION} replace />}
                  />
                  <Route path="general" element={<GeneralSection />} />
                  <Route path="mcp" element={<McpSection />} />
                  <Route path="members" element={<MembersSection />} />
                  <Route path="tags" element={<TagsSection />} />
                  <Route path="danger" element={<DangerZoneSection />} />
                  {/* Deliberately not a silent `<Navigate>`: a typo in a bookmark
                    should say so, inside the settings chrome, rather than
                    quietly landing somewhere else. */}
                  <Route
                    path="*"
                    element={
                      <Alert variant="warning" data-testid="no-such-section">
                        No such section.
                      </Alert>
                    }
                  />
                </Route>
                <Route
                  path="/audit"
                  element={
                    <Layout>
                      <AuditLogPage />
                    </Layout>
                  }
                />
                <Route
                  path="/account"
                  element={
                    <Layout>
                      <AccountPage />
                    </Layout>
                  }
                />
              </Route>

              <Route
                path="*"
                element={
                  <Layout>
                    <NotFoundPage />
                  </Layout>
                }
              />
            </Routes>
          </LiveSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
