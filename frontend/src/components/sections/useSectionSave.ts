import { useCallback, useState } from "react";

/** What {@link useSectionSave} hands a section. */
export interface SectionSave {
  /** Whether a request is in flight; disables the section's controls. */
  busy: boolean;
  /** The last failure, rendered inside this section's own card. */
  error: string | null;
  /** The last success, rendered inside this section's own card. */
  notice: string | null;
  /** Clear or set the error by hand, e.g. from a client-side check. */
  setError: (message: string | null) => void;
  /** Clear the notice, e.g. when a dismissible alert is closed. */
  setNotice: (message: string | null) => void;
  /**
   * Run one mutating request and report the outcome **in this section**.
   * @param fn - The request.
   * @param success - What to say when it worked.
   * @returns Whether it succeeded, so a caller can clear a draft only on success.
   */
  save: (fn: () => Promise<unknown>, success: string) => Promise<boolean>;
}

/**
 * Per-section busy / error / notice state.
 *
 * A long page with a single error Alert at the top renders a 406 — a duplicate
 * tag name, an email that is not one — hundreds of lines above the button that
 * caused it, with no scroll and nothing else changing, so the click looks like
 * it did nothing. The rule this hook enforces: **a section reports its own
 * failures, inside its own card.**
 *
 * `save` returns a boolean rather than throwing, because the common shape is
 * "clear the draft only if it worked" — and a draft cleared on failure loses what
 * somebody typed at exactly the moment they need it back.
 * @returns The state and the runner.
 */
export function useSectionSave(): SectionSave {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useCallback(
    async (fn: () => Promise<unknown>, success: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await fn();
        setNotice(success);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "That action failed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, error, notice, setError, setNotice, save };
}
