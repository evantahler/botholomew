export interface AbortHandle {
  controller: AbortController;
  signal: AbortSignal;
}

export function createAbortHandle(): AbortHandle {
  const controller = new AbortController();
  return { controller, signal: controller.signal };
}
