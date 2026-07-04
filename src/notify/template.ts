import type { Notification } from "./dispatch.ts";

/** Placeholder tokens substituted inside mcpx channel `args`. */
type Placeholder = "title" | "message" | "severity";

function substitute(value: string, n: Notification): string {
  return value.replace(
    /\{\{(title|message|severity)\}\}/g,
    (_match, key: Placeholder) => {
      if (key === "severity") return n.severity ?? "info";
      return n[key];
    },
  );
}

/**
 * Deep-walk an mcpx channel's `args` object, substituting `{{title}}`,
 * `{{message}}`, and `{{severity}}` inside every string value (including strings
 * nested in arrays/objects). Non-string leaves pass through untouched. Pure — no
 * I/O — so it's trivially unit-testable.
 */
export function renderTemplate(value: unknown, n: Notification): unknown {
  if (typeof value === "string") return substitute(value, n);
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, n));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = renderTemplate(v, n);
    }
    return out;
  }
  return value;
}

/** Render a full args object, preserving the `Record` shape. */
export function renderArgs(
  args: Record<string, unknown>,
  n: Notification,
): Record<string, unknown> {
  return renderTemplate(args, n) as Record<string, unknown>;
}
