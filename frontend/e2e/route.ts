import type { Route } from "@playwright/test";

/**
 * Whether a route handler failed because the page or the test is already gone.
 *
 * A route handler outlives the assertions around it: a live page can still have
 * a refresh in flight when the test ends, and the handler is then inside
 * `route.fetch()`, which surfaces as an error that is not part of any test and
 * fails the whole file.
 *
 * Teardown reaches the handler at whichever line it happens to be on, so the
 * message varies: the fetch itself reports `Test ended`, and a fetch that
 * already returned reports `Response has been disposed` from the `.json()`
 * after it. Both are the same race and both have to be named here.
 * @param error - What the handler threw.
 * @returns Whether the page or test is already gone.
 */
function isStalePlaywrightRoute(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Test ended|has been closed|Target closed|has been disposed/i.test(
    message,
  );
}

/**
 * Run a route handler, ignoring fetches that outlive the test.
 * @param handle - The real handler.
 * @returns A Playwright route callback.
 */
export function ignoreStaleRoute(
  handle: (route: Route) => Promise<void>,
): (route: Route) => Promise<void> {
  return async (route) => {
    try {
      await handle(route);
    } catch (error) {
      if (isStalePlaywrightRoute(error)) return;
      throw error;
    }
  };
}
