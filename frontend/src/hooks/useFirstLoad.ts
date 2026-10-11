import { useCallback, useRef, useState } from "react";

/** What {@link useFirstLoad} hands a page. */
export interface LoadState {
  /**
   * No answer has arrived yet. **The only state a skeleton may render in**, and
   * the only state in which an empty-state message must stay hidden.
   */
  loading: boolean;
  /** An answer is already on screen and a newer one is in flight. */
  reloading: boolean;
  /**
   * Declare a fetch started.
   * @param userInitiated - Whether a person asked for it. A live-channel
   *   refresh passes `false` and gets no indicator at all.
   */
  begin: (userInitiated?: boolean) => void;
  /** Declare it finished, however it finished. Call it from `finally`. */
  done: () => void;
}

/**
 * The first-answer flag a self-fetching page needs, and the refetch rule it
 * exists to enforce.
 *
 * **Three states, not two.** `loading` is *before the first answer* and is the
 * only one that may put a skeleton over the page. `reloading` is a refetch a
 * person asked for — a pagination click, a filter, the reload after a mutation —
 * and may only ever add an inline mark beside what is already on screen. A
 * live-channel refresh asks for neither: a caret blinking beside a header on
 * every ping is noise, and the content changing already says it is live.
 *
 * **`done()` never returns the page to `loading`, and nothing else can — there
 * is no exported way to set it back to `true`.** That is the whole reason this
 * is a hook rather than `useState(true)` written out nine times. The obvious
 * spelling, `setLoading(true)` at the top of `load()`, reads perfectly at the
 * call site and puts six skeleton rows over a table somebody is reading, every
 * time a ping arrives. Every settings section reloads after each mutation, so
 * that spelling is wrong in every one of them at once.
 *
 * Overlapping loads that share a query must only call `done()` for the request
 * that still owns the sequence. `done()` is permanent: a stale `finally` that
 * settles `loading` while a newer fetch is in flight is an empty table, not a
 * skeleton.
 *
 * The ref beside the state is `useSeededDraft`'s shape and is there for the same
 * reason: `begin` is called from inside a `useCallback`'d loader, and reading the
 * flag out of state there would put it in that loader's dependency list — so the
 * loader would be rebuilt, and re-fired, the instant the first answer landed.
 * Both calls are `useCallback([])`, so listing them in a dependency array is
 * free, which matters because biome's `useExhaustiveDependencies` asks for it.
 * @returns The flags and the two calls that move them.
 */
export function useFirstLoad(): LoadState {
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const settled = useRef(false);

  const begin = useCallback((userInitiated = true) => {
    if (settled.current && userInitiated) setReloading(true);
  }, []);

  const done = useCallback(() => {
    settled.current = true;
    setLoading(false);
    setReloading(false);
  }, []);

  return { loading, reloading, begin, done };
}
