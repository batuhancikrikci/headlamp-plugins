import { HIDDEN_ATTR, PLUGIN_NAME, PRIMARY_VAR } from './config';

const STYLE_ID = `${PLUGIN_NAME}-styles`;

// Style-only refinements on top of Headlamp's own look; PRIMARY_VAR is set by ThemeLock.
const css = `
  body {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Neutral scrollbar that reads well on both light and dark themes. */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background-color: rgba(128, 128, 128, 0.35); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background-color: rgba(128, 128, 128, 0.55); }

  ::selection {
    background: color-mix(in srgb, var(${PRIMARY_VAR}, Highlight) 25%, transparent);
    color: inherit;
  }

  /* Keyboard focus for clickable boxes without MUI's own focus ring (e.g. theme cards). */
  [role="button"]:not(.MuiButtonBase-root):focus-visible {
    outline: 2px solid var(${PRIMARY_VAR}, Highlight);
    outline-offset: 2px;
  }

  /* Keep "Custom Resources" (and its submenu) last in the sidebar, below plugin entries, which
     Headlamp appends after it. Each item is a link <li> followed by a submenu <li>; only the
     top-level list is reordered, with CSS order so React's DOM stays untouched. */
  .MuiDrawer-paper ul.MuiList-root:not(li ul):has(> li > a[href*="/crds"]) {
    display: flex;
    flex-direction: column;
  }
  .MuiDrawer-paper ul.MuiList-root:not(li ul) > li:has(> a[href*="/crds"]),
  .MuiDrawer-paper ul.MuiList-root:not(li ul) > li:has(> a[href*="/crds"]) + li:not(:has(> a)) {
    order: 1;
  }

  /* --- UI restrictions --- */
  [${HIDDEN_ATTR}] { display: none !important; }

  /* Language selector (Settings > General and anywhere else LocaleSelect is used). */
  dt:has(+ dd [aria-label="Select locale"]),
  dd:has([aria-label="Select locale"]),
  .MuiFormControl-root:has([aria-label="Select locale"]) {
    display: none !important;
  }
`;

export function injectGlobalStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
