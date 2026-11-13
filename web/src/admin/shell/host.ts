// The pages' root inside LuCI: a Shadow DOM host, so the theme's rules
// (Outline styles bare buttons, inputs, headings, .btn, .tabs, .notice) stop at
// its edge and ours never reach the theme. Its styles are one constructed
// stylesheet per text, adopted by every host that draws with it: nothing goes
// into <head>, which Outline's router reads as a reason to reload. The host
// takes LuCI's theme (html[data-darkmode], else the system's choice) as its
// data-theme, which the stylesheet follows (build/shadow-css.ts), and the
// keyboard's focus rings (.kbd, as the portal's main.ts does on <html>).
// What floats above the page lives in another host on <body> (layer.ts).

import { isDark } from '../ui/theme';
import { publishSprings } from '../../portal/motion';

const sheets = new Map<string, CSSStyleSheet>();

/** One stylesheet per text, shared by every host that adopts it. */
function sheetOf(css: string): CSSStyleSheet {
  let s = sheets.get(css);
  if (!s) {
    s = new CSSStyleSheet();
    s.replaceSync(css);
    sheets.set(css, s);
  }
  return s;
}

/** Sheets added later (a module loaded on demand: the map's), adopted after the page's by every host. */
const extra: CSSStyleSheet[] = [];

/** Another stylesheet for every host, those drawn already and those to come (once per text). */
export function addSheet(css: string) {
  const s = sheetOf(css);
  if (extra.includes(s)) return;
  extra.push(s);
  for (const h of hosts) if (h.shadowRoot) h.shadowRoot.adoptedStyleSheets = [...h.shadowRoot.adoptedStyleSheets, s];
}

/** Hosts that follow the theme and the keyboard. */
const hosts = new Set<HTMLElement>();

const theme = () => (isDark() ? 'dark' : 'light');

function paint() {
  const t = theme();
  for (const h of hosts) {
    // A page host gone with its page (LuCI navigated): let it go. The layer stays on <body>.
    if (!h.isConnected && h.dataset.placed) hosts.delete(h);
    else h.dataset.theme = t;
  }
}

let watching = false;
/** One observer for every host: Outline's theme button flips html[data-darkmode] in place. */
function watch() {
  if (watching) return;
  watching = true;
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-darkmode'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  // The focus ring only while the keyboard moves focus: on from Tab or an arrow, off at a press (portal main.ts).
  const KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  document.addEventListener('keydown', (e) => KEYS.has(e.key) && hosts.forEach((h) => h.classList.add('kbd')), true);
  document.addEventListener('pointerdown', () => hosts.forEach((h) => h.classList.remove('kbd')), true);
}

/**
 * A shadow host drawn with `css` (the bundled shadow stylesheet): `cls` on
 * the host, the theme on it now and as it changes, the portal's springs as
 * CSS variables.
 */
export function shadowHost(css: string, cls: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.className = cls;
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [sheetOf(css), ...extra];
  publishSprings(host);
  hosts.add(host);
  host.dataset.theme = theme();
  watch();
  // Marked once it is in the page, so paint() can tell a host not placed yet from one taken away (a second at most).
  let tries = 60;
  const mark = () => {
    if (host.isConnected) host.dataset.placed = '1';
    else if (--tries) requestAnimationFrame(mark);
  };
  requestAnimationFrame(mark);
  return { host, root };
}
