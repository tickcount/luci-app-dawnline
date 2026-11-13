// Glass icons: a tinted back shape, the same shape blurred behind a frosted
// front pane, a rim, and the detail strokes on top. The shapes are ours; every
// colour comes from the stylesheet (tone classes and the --gi-* tokens), never
// from a style attribute, which the page's CSP would drop. A picture draws
// the thing its place names, one picture has one meaning, and a named product
// wears its own mark (DESIGN.md › Glass icon catalogue).

import { iconSvg } from '../../shared/icons';
import { markup } from '../dom';

export type Tone = 'grey' | 'blue' | 'green' | 'red' | 'orange';

export interface GlassShape {
  /** The tinted back shape. */
  b: string;
  /** The frosted front pane. */
  f: string;
  /** Detail strokes on the pane. */
  d: string;
  /** A filled mark on the pane (its shapes in a 24 px box): an app's or a component's, alone or beside the strokes. */
  m?: () => string;
  /** The mark's size on the pane, of its 24 px box (default .385: AmneziaVPN's, about 9 px of a 14.5 px pane). */
  ms?: number;
  /** The mark's centre (default: the square pane's, 9.75 14.75), where strokes share the pane with it. */
  mc?: [x: number, y: number];
}

/** The square pane with its dot behind: what a mark, and many a picture, is drawn on. */
const DOT = '<circle cx="16" cy="8" r="6"/>';
const PANE = '<rect x="2.5" y="7.5" width="14.5" height="14.5" rx="4.2"/>';

/** A mark's size on the pane, of its 24 px box, grown or shrunk until each reads alike at a row's 28 px. */
const MARK_SIZE: Record<string, number> = { amnezia: 0.385, amneziawg: 0.46, wireguard: 0.46, v2raytun: 0.42, openwrt: 0.48, github: 0.48 };

/** A filled mark (its shapes in a 24 px box, `ms` of it) on the square pane. */
export const onPane = (m: () => string, ms: number): GlassShape => ({ b: DOT, f: PANE, d: '', m, ms });

/** A product's mark by its icon's name (shared/logos.ts) on the square pane: an app's, a component's. */
export const markShape = (mark: string): GlassShape => onPane(() => markOf(mark), MARK_SIZE[mark] ?? 0.385);

const GL: Record<string, GlassShape> = {
  phone: {
    b: '<rect x="10" y="2" width="10" height="16" rx="3"/>',
    f: '<rect x="4" y="5" width="11.5" height="17" rx="3.2"/>',
    d: '<path d="M8.3 19h3.9"/>',
  },
  mobile: {
    b: '<rect x="8.5" y="2" width="13.5" height="17" rx="2.6"/>',
    f: '<rect x="2.5" y="7" width="9.5" height="15" rx="2.6"/>',
    d: '<path d="M6 19.4h2.5"/>',
  },
  tablet: {
    b: '<rect x="9.5" y="2" width="12" height="15" rx="2.6"/>',
    f: '<rect x="2.5" y="5.5" width="14.5" height="16.5" rx="2.8"/>',
    d: '<path d="M8 19h3.5"/>',
  },
  computer: {
    b: '<rect x="6" y="14" width="17" height="7" rx="2.2"/>',
    f: '<rect x="1.5" y="3.5" width="19" height="13" rx="2.6"/>',
    d: '<path d="M5.5 12.5h5"/>',
  },
  router: {
    b: '<rect x="5.5" y="2" width="2.8" height="11" rx="1.4"/><rect x="15.7" y="2" width="2.8" height="11" rx="1.4"/>',
    f: '<rect x="2" y="10.5" width="20" height="10.5" rx="3"/>',
    d: '<path d="M6.6 15.75h.4M10 15.75h.4" stroke-width="2.4"/>',
  },
  other: { b: '<circle cx="16" cy="8" r="6"/>', f: '<rect x="2.5" y="8" width="14" height="14" rx="3.6"/>', d: '' },
  plus: {
    b: '<rect x="9" y="2" width="13" height="13" rx="4"/>',
    f: '<circle cx="10" cy="14" r="8"/>',
    d: '<path d="M10 10.6v6.8M6.6 14h6.8"/>',
  },
  globe: {
    b: '<circle cx="16" cy="8" r="6"/>',
    f: '<circle cx="10.5" cy="13.5" r="8.5"/>',
    d: '<path d="M2.5 13.5h16" stroke-width="1.1"/><path d="M10.5 5.2c2.4 2.6 2.4 14 0 16.6M10.5 5.2c-2.4 2.6-2.4 14 0 16.6" stroke-width="1.1"/>',
  },
  home: {
    b: '<rect x="12" y="2" width="10" height="10" rx="3"/>',
    f: '<path d="M2.5 11.6 10.5 5l8 6.6V20a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z"/>',
    d: '<path d="M8.8 22v-4.2h3.4V22"/>',
  },
  shield: {
    b: '<circle cx="16" cy="8" r="6"/>',
    f: '<path d="M10.5 4.5l7.5 2.8v5.4c0 4.6-3.2 7.4-7.5 8.8C6.2 20.1 3 17.3 3 12.7V7.3z"/>',
    d: '<path d="M7.3 13.2l2.3 2.3 4.2-4.6"/>',
  },
  chart: {
    b: '<rect x="14.5" y="2" width="7" height="20" rx="2.6"/>',
    f: '<rect x="2.5" y="8.5" width="14" height="13.5" rx="3.4"/>',
    d: '<path d="M6 18l2.8-3 2.2 1.8L14 12.8"/>',
  },
  calendar: {
    b: '<rect x="8.5" y="2" width="13.5" height="13" rx="3"/>',
    f: '<rect x="2" y="6" width="15.5" height="16" rx="3.4"/>',
    d: '<path d="M2.4 10.6h14.7" stroke-width="1"/><path d="M6.2 14.6h.4M9.5 14.6h.4M12.8 14.6h.4M6.2 18h.4M9.5 18h.4" stroke-width="2.2"/>',
  },
  pause: {
    b: '<rect x="12" y="2" width="10" height="10" rx="3"/>',
    f: '<circle cx="10.5" cy="13.5" r="8.5"/>',
    d: '<path d="M8.6 10.5v6M12.4 10.5v6"/>',
  },
  // a server: a terminal's prompt and, beside it, the mark of the core it runs on (every one runs AmneziaWG
  // today; another core brings its own mark here)
  server: { b: DOT, f: PANE, d: '<path d="M5.1 12.5l2.3 2.25-2.3 2.25"/>', m: () => markOf('amneziawg'), ms: 0.34, mc: [12.2, 14.75] },
  link: {
    b: '<rect x="11.5" y="1.5" width="8" height="14" rx="4" transform="rotate(45 15.5 8.5)"/>',
    f: '<rect x="4.5" y="8.5" width="8" height="14" rx="4" transform="rotate(45 8.5 15.5)"/>',
    d: '<path d="M9.8 14.2l4.4-4.4"/>',
  },
  key: {
    b: '<rect x="10" y="10" width="12.5" height="5" rx="2.5"/><rect x="17" y="13" width="3.4" height="6" rx="1.4"/>',
    f: '<circle cx="8" cy="12.5" r="6.5"/>',
    d: '<circle cx="6.6" cy="12.5" r="1.7"/>',
  },
  lock: {
    b: '<rect x="7" y="2" width="10" height="11" rx="5"/>',
    f: '<rect x="3" y="9" width="18" height="13" rx="3.4"/>',
    d: '<path d="M12 14v3"/>',
  },
  check: {
    b: '<circle cx="14.5" cy="9.5" r="7.5"/>',
    f: '<circle cx="10.5" cy="13.5" r="8.5"/>',
    d: '<path d="M6.6 13.8l2.7 2.7 5.3-5.6"/>',
  },
  trash: {
    b: '<rect x="3" y="2.5" width="18" height="5" rx="2.3"/>',
    f: '<path d="M4.8 8.5h14.4l-1.1 11.6a2.2 2.2 0 0 1-2.2 1.9H8.1a2.2 2.2 0 0 1-2.2-1.9z"/>',
    d: '<path d="M10 12v6M14 12v6"/>',
  },
  refresh: {
    b: '<circle cx="16" cy="8" r="6"/>',
    f: '<circle cx="10.5" cy="13.5" r="8.5"/>',
    d: '<path d="M14.2 11.3a4.2 4.2 0 1 0 .3 3.6"/><path d="M14.6 8.8v2.8h-2.8"/>',
  },
  // a page in a browser window: the page itself, a browser, the personal portal in the admin
  browser: {
    b: '<rect x="8.5" y="2" width="13.5" height="12" rx="3"/>',
    f: '<rect x="2" y="6.5" width="16.5" height="15" rx="3.4"/>',
    d: '<path d="M2.4 11h15.7" stroke-width="1"/><path d="M5.3 8.8h.3M7.9 8.8h.3" stroke-width="2"/><path d="M5.8 14.6h6.6M5.8 17.8h3.8"/>',
  },
  // an access that reaches both: the internet, with the home behind it
  both: {
    b: '<path d="M10.5 9.4 16.4 4.4l5.9 5v6.1a1.6 1.6 0 0 1-1.6 1.6h-8.6a1.6 1.6 0 0 1-1.6-1.6z"/>',
    f: '<circle cx="10" cy="14" r="8"/>',
    d: '<path d="M2.4 14h15.2" stroke-width="1.1"/><path d="M10 6.2c2.3 2.5 2.3 13.1 0 15.6M10 6.2c-2.3 2.5-2.3 13.1 0 15.6" stroke-width="1.1"/>',
  },
  file: {
    b: '<rect x="9" y="2" width="12.5" height="15" rx="3"/>',
    f: '<rect x="2.5" y="6" width="13.5" height="16" rx="3.2"/>',
    d: '<path d="M6.2 11h6.5M6.2 14.5h6.5M6.2 18h4"/>',
  },
  lan: {
    b: DOT,
    f: PANE,
    d: '<rect x="8.3" y="10.4" width="2.9" height="2.6" rx=".7"/><rect x="5.2" y="16.4" width="2.9" height="2.6" rx=".7"/><rect x="11.4" y="16.4" width="2.9" height="2.6" rx=".7"/><path d="M9.75 13v1.8M6.65 16.4v-1.6h6.2v1.6"/>',
  },
};

/** A mark of the icons (an app's, shared/logos.ts) without its own svg: to be drawn on a pane. */
const markOf = (name: string): string =>
  iconSvg(name, '')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');

/** A mark of `ms` of its 24 px box, centred at `c` (the square pane's centre unless the shape says). */
const markAt = (ms: number, [x, y]: [number, number] = [9.75, 14.75]): string =>
  `translate(${+(x - 12 * ms).toFixed(3)} ${+(y - 12 * ms).toFixed(3)}) scale(${ms})`;

let gid = 0;
/** A shape drawn as glass, as markup (`cls`: its classes, e.g. "gi xl"). */
function glassSvg(g: GlassShape, tone: Tone, cls: string): string {
  const id = `gl${++gid}`;
  // strokes, a mark, or both (a server: its prompt and its core's mark)
  const detail =
    (g.d || !g.m ? `<g class="gd" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${g.d}</g>` : '') +
    (g.m ? `<g class="gdf" fill="currentColor" transform="${markAt(g.ms ?? 0.385, g.mc)}">${g.m()}</g>` : '');
  return (
    `<svg class="${cls} t-${tone}" viewBox="0 0 24 24" aria-hidden="true"><defs>` +
    `<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="ta"/><stop offset="1" class="tb"/></linearGradient>` +
    `<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fa"/><stop offset=".55" class="fb"/><stop offset="1" class="fc"/></linearGradient>` +
    `<clipPath id="${id}c">${g.f}</clipPath><filter id="${id}x" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.5"/></filter></defs>` +
    `<g fill="url(#${id}b)">${g.b}</g><g clip-path="url(#${id}c)"><g fill="url(#${id}b)" filter="url(#${id}x)">${g.b}</g></g>` +
    `<g fill="url(#${id}f)">${g.f}</g><g class="ge" fill="none" stroke-width="1.1">${g.f}</g>` +
    `<g class="gr" fill="none" stroke-width=".6">${g.f}</g>${detail}</svg>`
  );
}

/** A glass icon as an element. */
export const glass = (name: string, tone: Tone = 'grey', cls = 'gi'): Element => markup(glassSvg(GL[name] ?? GL.other, tone, cls));

/** A shape of the caller's own drawn the same way (the admin's objects the portal has no picture for). */
export const glassOf = (g: GlassShape, tone: Tone = 'grey', cls = 'gi'): Element => markup(glassSvg(g, tone, cls));
