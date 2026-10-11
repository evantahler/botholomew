/* Botholomew theme — backend copy for the framework-rendered OAuth page.
 *
 * Keryx renders that surface server-side and inlines whatever
 * `config.server.web.theme` points at. Bun cannot compile SCSS in that path, so
 * this module default-exports plain CSS.
 *
 * THE THEME IS WRITTEN TWICE BY DESIGN. This backend copy mirrors the active
 * `[data-bh-theme="slate"]` token block in `frontend/src/styles/themes/_tokens.scss`.
 * Neither build can import the other, so parity is asserted in
 * `frontend/src/__tests__/theme-tokens.test.ts`.
 */

const GROUND = "#06070a";
const SURFACE = "#0f131a";
const RAISE = "#151a23";
const SUNKEN = "#0a0c11";
const BORDER = "#222b39";
const BORDER_STRONG = "#344155";
const TEXT = "#c9d3e2";
const HEADING = "#e9eff8";
const MUTED = "#758399";
const ACCENT = "#8b7cff";
const ACCENT_FG = "#ffffff";
const MARKER = "#f472b6";
const LINK_HOVER = "#b4a9ff";
const WARNING = "#fbbf24";
const DANGER = "#fb7185";
const FONT_BODY =
  '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* Keryx inlines `DEFAULT_THEME_CSS` first and `oauth-common.css` second. The
 * block below overrides tokens, and the element rules override hardcoded values
 * in `oauth-common.css` that tokens cannot touch. */
const css = `
:root{
  --keryx-font-family:${FONT_BODY};
  --keryx-color-primary:${ACCENT};
  --keryx-color-primary-hover:${LINK_HOVER};
  --keryx-color-accent:${MARKER};
  --keryx-bg:${GROUND};
  --keryx-surface:${SURFACE};
  --keryx-color-text:${TEXT};
  --keryx-color-text-muted:${MUTED};
  --keryx-color-border:${BORDER};
  --keryx-radius:0.35rem;
  --bh-ground:${GROUND};
  --bh-surface:${SURFACE};
  --bh-raise:${RAISE};
  --bh-sunken:${SUNKEN};
  --bh-border:${BORDER};
  --bh-border-strong:${BORDER_STRONG};
  --bh-text:${TEXT};
  --bh-heading:${HEADING};
  --bh-muted:${MUTED};
  --bh-accent:${ACCENT};
  --bh-accent-fg:${ACCENT_FG};
  --bh-marker:${MARKER};
  --bh-link-hover:${LINK_HOVER};
  --bh-warning:${WARNING};
  --bh-danger:${DANGER};
  --bh-radius:.35rem;
  --bh-radius-sm:.25rem;
  --bh-radius-lg:.45rem;
  --bh-border-width:1px;
  --bh-font-body:${FONT_BODY};
  --bh-font-mono:${FONT_MONO};
  --bh-font-size:.8125rem;
  --bh-line-height:1.4;
}
body{
  background:radial-gradient(900px 420px at 50% -16%,rgba(139,124,255,.055),transparent 70%),var(--bh-ground);
  color:var(--bh-text);
  font-family:var(--bh-font-body);
  font-size:13px;
  line-height:1.4;
  color-scheme:dark;
  -webkit-font-smoothing:antialiased;
}
.container{
  background:var(--bh-surface);
  border:1px solid var(--bh-border);
  border-radius:0.45rem;
  box-shadow:0 1px 2px rgba(0,0,0,.25);
  padding:24px;
  max-width:460px;
}
h2{
  color:var(--bh-heading);
  font-size:1rem;
  font-weight:650;
  letter-spacing:-.01em;
  margin-bottom:14px;
}
p{color:var(--bh-muted);font-size:12px}
label{
  color:var(--bh-muted);
  font-size:11px;
  font-weight:650;
  letter-spacing:.055em;
  text-transform:uppercase;
  margin-bottom:2px;
}
input[type="text"],input[type="email"],input[type="password"]{
  background:var(--bh-sunken);
  border:1px solid var(--bh-border);
  border-radius:.35rem;
  caret-color:var(--bh-accent);
  color:var(--bh-text);
  font-family:var(--bh-font-body);
  font-size:.75rem;
  padding:6px 8px;
}
input:focus{
  border-color:var(--bh-accent);
  box-shadow:0 0 0 2px var(--bh-ground),0 0 0 4px color-mix(in srgb,var(--bh-accent) 65%,transparent);
  outline:none;
}
button{
  background:var(--bh-accent);
  border:1px solid var(--bh-accent);
  border-radius:.3rem;
  color:var(--bh-accent-fg);
  font-family:var(--bh-font-body);
  font-size:.74rem;
  font-weight:650;
  letter-spacing:.02em;
  min-height:1.8rem;
  padding:.45rem .7rem;
  text-transform:none;
}
button:hover{
  background:color-mix(in srgb,var(--bh-accent) 86%,#fff);
  border-color:color-mix(in srgb,var(--bh-accent) 90%,#fff);
}
button:focus-visible{
  box-shadow:0 0 0 2px var(--bh-ground),0 0 0 4px color-mix(in srgb,var(--bh-accent) 65%,transparent);
  outline:none;
}
.error{
  background:var(--bh-surface);
  border:1px solid var(--bh-border);
  border-left:3px solid var(--bh-danger);
  border-radius:.35rem;
  color:var(--bh-text);
  font-size:12px;
}
.client-info{
  background:var(--bh-raise);
  border:1px solid var(--bh-border);
  border-left:3px solid var(--bh-marker);
  border-radius:.35rem;
}
.client-info strong{color:var(--bh-heading)}
.client-detail{color:var(--bh-muted)}
.client-warning{color:var(--bh-warning)}
.tabs{border-bottom:1px solid var(--bh-border)}
.tab{
  border-bottom:2px solid transparent;
  color:var(--bh-muted);
  font-size:11px;
  font-weight:650;
  letter-spacing:.045em;
  text-transform:uppercase;
}
.tab:hover{color:var(--bh-text)}
.tab.active{
  border-bottom-color:var(--bh-accent);
  color:var(--bh-heading);
  font-weight:650;
}
.closing{color:var(--bh-muted);font-size:12px}
.checkmark{
  background:var(--bh-raise);
  border:1px solid var(--bh-accent);
  border-radius:999px;
}
.checkmark svg{stroke:var(--bh-accent)}
/* Our glyph is monochrome and inherits \`currentColor\`. */
.owl{color:var(--bh-muted);opacity:1}
::selection{background:rgba(139,124,255,.35)}
`;

export default css;
