import { Navigate, Outlet, useLocation } from "react-router-dom";
import Spinner from "#ui/Spinner";
import { useAuth } from "../context/AuthContext";

/**
 * Route guard for authenticated pages. While the first hydration is in flight it
 * renders a spinner — redirecting before `/me` answers would bounce a signed-in
 * user to the sign-in page on every hard refresh. Once settled: no user →
 * `/sign-in`; signed in with zero projects → `/projects/new`, since Botholomew is
 * unusable without a tenant. That page is exempt from the redirect, or it would
 * bounce to itself forever.
 * @returns A spinner, a redirect, or the nested route.
 */
export default function ProtectedRoute() {
  const { user, projects, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="d-flex justify-content-center py-5"
        data-testid="auth-loading"
      >
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  if (projects.length === 0 && location.pathname !== "/projects/new") {
    return <Navigate to="/projects/new" replace />;
  }

  return <Outlet />;
}
