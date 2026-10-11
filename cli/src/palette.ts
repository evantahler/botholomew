/**
 * The CLI's colors: the slate theme's tokens, so a terminal and the website
 * agree on what "accent" and "danger" look like.
 *
 * Copied from the `[data-bh-theme="slate"]` token block the backend's OAuth
 * theme (`backend/theme/botholomew-theme.ts`) and the frontend's
 * `styles/themes/_tokens.scss` share. This process has no CSS build to import
 * them from, so the values are restated here.
 */
export const PALETTE = {
  ground: "#06070a",
  surface: "#0f131a",
  text: "#c9d3e2",
  heading: "#e9eff8",
  muted: "#758399",
  accent: "#8b7cff",
  marker: "#f472b6",
  warning: "#fbbf24",
  danger: "#fb7185",
} as const;
