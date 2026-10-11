import { useCallback, useEffect, useRef, useState } from "react";

/** What {@link useSeededDraft} hands a section. */
export interface SeededDraft<T> {
  /** The current draft. */
  draft: T;
  /** Change one or more fields, marking the draft edited. */
  update: (patch: Partial<T>) => void;
  /** Whether the draft holds edits the server has not seen. */
  edited: boolean;
  /**
   * Declare the draft saved, so the reload that follows re-seeds it from what
   * the server actually stored. Call it **before** the request, not after.
   */
  markSaved: () => void;
  /** Throw the draft away and re-seed from the server's current answer. */
  reset: () => void;
}

/**
 * A form draft seeded from server data, which a background reload must not
 * overwrite while somebody is typing into it.
 *
 * The comment is the point of the hook. A section reloads on mount, again when
 * the active project hydrates, again after every mutation any section performs,
 * and twice over each of those in development where StrictMode double-invokes
 * effects. A draft that re-seeds every field from the server on each of those
 * silently reverts what is being typed or toggled when a load resolves
 * mid-edit — and the save then posts the old value. In an e2e run it looks like
 * a switch that a background refresh turns back on after every click.
 *
 * So: re-seed **only while the draft is untouched**. After a successful save it
 * is untouched by definition, which is why {@link SeededDraft.markSaved} is
 * called before the request rather than after — the reload that follows is
 * supposed to win.
 *
 * **The rule this hook exists to enforce, stated so it is not broken:** no
 * section may write `useEffect(() => setX(detail.x), [detail])` of its own.
 * That is the reverting-switch bug, and it looks completely reasonable at the
 * call site.
 * @param seed - Builds the draft from current server data. Called on every
 *   render, so it must be cheap and must not allocate anything held elsewhere.
 * @param deps - The server data the seed reads; re-seeding is attempted when it
 *   changes.
 * @returns The draft and its controls.
 */
export function useSeededDraft<T extends object>(
  seed: () => T,
  deps: readonly unknown[],
): SeededDraft<T> {
  const [draft, setDraft] = useState<T>(seed);
  const edited = useRef(false);
  // Read inside the effect rather than listed as a dependency: `seed` is a fresh
  // closure on every render, so depending on it would re-seed continuously.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const [editedFlag, setEditedFlag] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `deps` is the
  // caller's declaration of what the seed reads, which is exactly the dependency
  // list wanted here; `seedRef` is deliberately not one.
  useEffect(() => {
    if (edited.current) return;
    setDraft(seedRef.current());
  }, deps);

  const update = useCallback((patch: Partial<T>) => {
    edited.current = true;
    setEditedFlag(true);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const markSaved = useCallback(() => {
    edited.current = false;
    setEditedFlag(false);
  }, []);

  const reset = useCallback(() => {
    edited.current = false;
    setEditedFlag(false);
    setDraft(seedRef.current());
  }, []);

  return { draft, update, edited: editedFlag, markSaved, reset };
}
