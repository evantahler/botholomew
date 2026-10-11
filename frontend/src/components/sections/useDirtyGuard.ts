import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/** What {@link useDirtyGuard} hands a shell. */
export interface DirtyGuard {
  /** Which section is holding unsaved edits, or `null`. */
  dirtySlug: string | null;
  /** A section reporting whether it holds unsaved edits. */
  markDirty: (slug: string, dirty: boolean) => void;
  /**
   * Intercept a navigation away from a dirty section.
   * @returns Whether the click was swallowed, i.e. whether the caller must
   * `preventDefault()`.
   */
  onNavigate: (slug: string) => boolean;
  /** Where a swallowed click was headed, or `null` when nothing is pending. */
  pendingNav: string | null;
  /** Stay where we are, keeping the draft. */
  cancelNav: () => void;
  /** Throw the draft away and follow the swallowed click. */
  confirmNav: () => void;
}

/**
 * The unsaved-changes guard for a sidebar-of-sections shell.
 *
 * Only one section is mounted at a time, so only one can be dirty and a single
 * slug is the whole state. `markDirty` clears **only when the clearing slug
 * matches**, so a section unmounting cannot wipe the flag another one just set.
 *
 * Two of the three ways to leave a dirty section are covered here: the sidebar's
 * own click, through `onNavigate` plus whatever modal the shell renders, and tab
 * close or hard refresh, through `beforeunload`. **Browser Back stays uncovered**
 * — `useBlocker` is what would catch it and it needs a data router this app does
 * not use. See `SectionNav`'s `onNavigate` for why that is not a thing to go and
 * fix casually.
 * @param basePath - The area's route prefix, e.g. `/settings`.
 * @returns See {@link DirtyGuard}.
 */
export function useDirtyGuard(basePath: string): DirtyGuard {
  const navigate = useNavigate();
  const [dirtySlug, setDirtySlug] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const markDirty = useCallback((slug: string, dirty: boolean) => {
    setDirtySlug((current) =>
      dirty ? slug : current === slug ? null : current,
    );
  }, []);

  useEffect(() => {
    if (!dirtySlug) return;
    /**
     * Ask the browser to confirm leaving.
     * @param event - The unload event.
     */
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySlug]);

  const onNavigate = useCallback(
    (slug: string): boolean => {
      if (!dirtySlug || dirtySlug === slug) return false;
      setPendingNav(slug);
      return true;
    },
    [dirtySlug],
  );

  const cancelNav = useCallback(() => setPendingNav(null), []);

  const confirmNav = useCallback(() => {
    const to = pendingNav;
    setPendingNav(null);
    setDirtySlug(null);
    if (to) navigate(to.startsWith("/") ? to : `${basePath}/${to}`);
  }, [basePath, navigate, pendingNav]);

  return {
    dirtySlug,
    markDirty,
    onNavigate,
    pendingNav,
    cancelNav,
    confirmNav,
  };
}
