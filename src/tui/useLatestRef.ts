import { useRef } from "react";

/**
 * Returns a ref whose `.current` is always the latest committed value.
 *
 * Workaround for a stale-closure issue we hit with Ink 7's `useInput`: the
 * callback we pass is wrapped in React's `useEffectEvent`, but on Bun + React
 * 19.2 the keyboard handler often sees the *initial* render's closure even
 * after subsequent commits (e.g. an `entries` array still appearing empty
 * after the populating `setState` has rendered). Reading from a ref that's
 * eagerly assigned during render side-steps the issue — refs always read the
 * latest assigned value regardless of which closure the caller is in.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
