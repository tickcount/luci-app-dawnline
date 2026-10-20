// Dawnline admin styles, built on the Outline theme's design tokens
// (luci-theme-outline: --panel-bg, --border, --muted, --accent, --success-a15,
// …). Every token has a fallback so other themes still get a sane look.
// Outline switches dark mode with html[data-darkmode], and its tokens follow
// it automatically; only the fallbacks in base.css have a dark variant (LuCI
// Bootstrap sets the same attribute).
//
// One file per feature, imported as text (tsup minifies them, see
// tsup.config.ts) and joined in cascade order: later files override earlier ones.
//
// The <style> element is rendered inside each view (not <head>): Outline's
// same-document router treats unknown head styles as a reason to reload.

import base from './base.css';
import people from './people.css';
import controls from './controls.css';
import disguise from './disguise.css';
import overview from './overview.css';
import dialogs from './dialogs.css';
import portalSettings from './portal-settings.css';
import health from './health.css';
import layout from './layout.css';
import map from './map.css';
import person from './person.css';
import drawer from './drawer.css';
import settings from './settings.css';
import components from './components.css';
import access from './access.css';

export const CSS = [
  base,
  people,
  controls,
  disguise,
  overview,
  dialogs,
  portalSettings,
  health,
  layout,
  map,
  person,
  drawer,
  settings,
  components,
  access,
].join('\n');

/** A <style> element for the view root (see the note at the top). */
export function styleNode(): HTMLStyleElement {
  const el = document.createElement('style');
  el.dataset.dawnline = '1';
  el.textContent = CSS;
  return el;
}
