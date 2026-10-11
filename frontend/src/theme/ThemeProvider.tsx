import type { ReactNode } from "react";

/**
 * Documents that the application has one theme boundary.
 *
 * The fixed theme is installed synchronously in `index.html`; this component
 * intentionally owns no state, storage, or setter.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return children;
}
