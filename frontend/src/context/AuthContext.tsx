import type { ActionsPermissions } from "@backend/actions/actions-permissions";
import type { MeView } from "@backend/actions/me";
import type { ProjectList } from "@backend/actions/project/project-list";
import type { ActionResponse } from "keryx";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "../utils/client";

/** The signed-in user, derived from the backend's `me:view` action. */
export type AuthUser = ActionResponse<MeView>["user"];
/** A project the user belongs to, derived from `project:list`. */
export type AuthProject = ActionResponse<ProjectList>["projects"][number];
/** The action → requirement map, derived from `actions:permissions`. */
export type Permissions = ActionResponse<ActionsPermissions>["permissions"];

/** Everything the app needs to know about the current session. */
export interface AuthState {
  /** The signed-in user, or `null` when signed out. */
  user: AuthUser | null;
  /** The projects the user belongs to. */
  projects: AuthProject[];
  /** The selected project's id, or `null` when there is none. */
  activeProjectId: number | null;
  /** The RBAC map the backend reports — server truth for UI gating. */
  permissions: Permissions | null;
  /** True until the first hydration settles. */
  loading: boolean;
  /** Select the active project (persisted to `localStorage`). */
  setActiveProject: (projectId: number) => void;
  /** Re-hydrate the user and their projects from the backend. */
  refresh: () => Promise<void>;
  /** Destroy the session and clear local auth state. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ACTIVE_PROJECT_KEY = "botholomew.activeProjectId";

/**
 * Provides authentication state to the app. On mount it loads the public
 * permissions map and hydrates the session in parallel; `GET /me` failing is how
 * "signed out" is detected, so the two are `allSettled` rather than chained.
 * Wrap the app in this once, near the root.
 * @param props.children - The subtree that consumes {@link useAuth}.
 * @returns The provider element.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [projects, setProjects] = useState<AuthProject[]>([]);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(() => {
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
    return stored ? Number(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  const setActiveProject = useCallback((projectId: number) => {
    setActiveProjectId(projectId);
    localStorage.setItem(ACTIVE_PROJECT_KEY, String(projectId));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await apiFetch<ActionResponse<MeView>>("/me");
      setUser(me.user);

      const list = await apiFetch<ActionResponse<ProjectList>>(
        "/projects?limit=100",
      );
      setProjects(list.projects);

      // Self-heal a stale selection: a project can be left, deleted, or belong to
      // a different account than the one this browser last signed in as.
      setActiveProjectId((current) => {
        if (current && list.projects.some((p) => p.id === current)) {
          return current;
        }
        const next = list.projects[0]?.id ?? null;
        if (next) localStorage.setItem(ACTIVE_PROJECT_KEY, String(next));
        else localStorage.removeItem(ACTIVE_PROJECT_KEY);
        return next;
      });
    } catch {
      setUser(null);
      setProjects([]);
      setActiveProjectId(null);
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/session", { method: "DELETE" });
    } finally {
      // Clear local state even if the request failed — the user asked to be
      // signed out, and a stale cookie is the server's problem to expire.
      setUser(null);
      setProjects([]);
      setActiveProjectId(null);
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [perms] = await Promise.allSettled([
        apiFetch<ActionResponse<ActionsPermissions>>("/actions/permissions"),
        refresh(),
      ]);
      if (!cancelled && perms.status === "fulfilled") {
        setPermissions(perms.value.permissions);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      projects,
      activeProjectId,
      permissions,
      loading,
      setActiveProject,
      refresh,
      signOut,
    }),
    [
      user,
      projects,
      activeProjectId,
      permissions,
      loading,
      setActiveProject,
      refresh,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the current {@link AuthState}.
 * @returns The current auth state.
 * @throws {Error} If called outside an {@link AuthProvider}.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
