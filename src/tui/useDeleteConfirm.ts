import { useEffect, useRef, useState } from "react";

/**
 * Two-press delete confirmation. First press arms; second press within
 * `ttlMs` confirms. Any non-`d` keystroke should call `cancel()`. The TTL
 * is a safety net for idle/escape.
 */

export interface DeleteConfirmController {
  isArmed(): boolean;
  armedLabel(): string | null;
  pressDelete: (label: string) => void;
  cancel: () => void;
  dispose: () => void;
}

export function createDeleteConfirmController(
  onConfirm: () => void,
  opts: { ttlMs?: number; onChange?: () => void } = {},
): DeleteConfirmController {
  const ttlMs = opts.ttlMs ?? 3000;
  let armed = false;
  let label: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const notify = () => {
    opts.onChange?.();
  };

  const pressDelete = (next: string) => {
    if (armed) {
      clearTimer();
      armed = false;
      label = null;
      notify();
      onConfirm();
      return;
    }
    armed = true;
    label = next;
    timer = setTimeout(() => {
      armed = false;
      label = null;
      timer = null;
      notify();
    }, ttlMs);
    notify();
  };

  const cancel = () => {
    if (!armed && !timer) return;
    clearTimer();
    armed = false;
    label = null;
    notify();
  };

  const dispose = () => {
    clearTimer();
  };

  return {
    isArmed: () => armed,
    armedLabel: () => label,
    pressDelete,
    cancel,
    dispose,
  };
}

export interface UseDeleteConfirmResult {
  armed: boolean;
  armedLabel: string | null;
  pressDelete: (label: string) => void;
  cancel: () => void;
}

export function useDeleteConfirm(
  onConfirm: () => void,
  opts: { ttlMs?: number } = {},
): UseDeleteConfirmResult {
  const [, setTick] = useState(0);

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const controllerRef = useRef<DeleteConfirmController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDeleteConfirmController(
      () => onConfirmRef.current(),
      { ttlMs: opts.ttlMs, onChange: () => setTick((t) => t + 1) },
    );
  }

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  const c = controllerRef.current;
  return {
    armed: c.isArmed(),
    armedLabel: c.armedLabel(),
    pressDelete: c.pressDelete,
    cancel: c.cancel,
  };
}
