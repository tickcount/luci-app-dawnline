// The page on screen, and going from one page of Dawnline to another without leaving the view. Each section is a
// LuCI view of its own, so a link between them used to be a navigation of the theme's: the whole view was taken
// down and drawn again, the section row with it, which blinked on every move (the owner, 2026-11-12: «мне не
// нравится то, что это мигает при переходах»). Now a move between Dawnline's own pages happens here: the address
// is pushed (Outline's router leaves a view's own history entries to it, as it does for a server's parts), the
// page under the row is taken down and the next one opened in its place, and the row itself stays the very node
// it was, its pill gliding to the section (shell/nav.ts). A reload, a bookmark and a link from outside still open
// the section's own view, which draws the same page.
//
// What LuCI would have done for a view that goes is done here: whoever listens for the page going is told
// (ui/nav.ts onNavigate: pollers, regions, docks, tips), and the listeners the page put on the window and the
// document while it was made and drawn are taken off (the theme's router does the same for a view it tears down).

import type { Loaded, Page } from './view';
import { enter } from '../ui/entrance';
import { LEAVE } from '../ui/nav';
import { scroller } from '../ui/subpage';
import { markSection } from './nav';
import { target } from './redirects';
import { href, type Place } from './routes';
import { plain } from './sheets';
import { shellVisits } from './visit';
import { pageIn, waitFor } from './waiting';

/** The pages: a server's page draws two views (its own and its people's). */
export type Kind = 'overview' | 'log' | 'server' | 'settings';
const KIND: Record<string, Kind> = {
  overview: 'overview',
  dawnline: 'overview',
  log: 'log',
  server: 'server',
  people: 'server',
  settings: 'settings',
};

interface Heard {
  target: Window | Document;
  type: string;
  fn: EventListenerOrEventListenerObject;
  opts?: boolean | AddEventListenerOptions;
}

interface Stage {
  root: ShadowRoot;
  kind: Kind;
  /** What the page put on the window and the document while it was made and drawn. */
  heard: Heard[];
}

let stage: Stage | null = null;
let make: Record<Kind, () => Page<unknown>> | null = null;
let listening = false;

/** The pages by kind (main.ts has the classes). */
export function setPages(m: Record<Kind, () => Page<unknown>>) {
  make = m;
}

/** Run `fn`, keeping note of the listeners it puts on the window and the document. */
function hearing<T>(into: Heard[], fn: () => T): T {
  const undo = ([window, document] as const).map((t) => {
    const add = t.addEventListener;
    t.addEventListener = function (
      this: unknown,
      type: string,
      f: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) {
      into.push({ target: t, type, fn: f, opts });
      return add.call(this as Window, type, f, opts);
    } as typeof t.addEventListener;
    return () => (t.addEventListener = add);
  });
  try {
    return fn();
  } finally {
    undo.forEach((u) => u());
  }
}

/** The place an address names, when it is one of Dawnline's (old addresses sent on, as their views do). */
function placeOf(url: URL): Place | null {
  if (url.origin !== location.origin) return null;
  // where Dawnline's views live, as this LuCI says addresses (L.url): a view is the next part of the path
  const base = new URL(href({ view: 'overview' }), location.href).pathname.replace(/\/overview$/, '');
  const path = url.pathname.replace(/\/$/, '');
  // Dawnline's own menu item is Overview
  const view = path === base ? 'overview' : path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
  if (view === null || view.includes('/')) return null;
  const at = { view, query: url.search.replace(/^\?/, '') };
  return target(at.view, at.query) ?? at;
}

/** The kind of the page at this address, or null: not a page of Dawnline's. */
function kindHere(): Kind | null {
  const p = placeOf(new URL(location.href));
  return p ? (KIND[p.view] ?? null) : null;
}

/**
 * Draw `page` into `root` as the page on screen: at once from its data, or waiting for it (shell/waiting.ts).
 * `nav`: the section row that stands already (a move from another page).
 */
export function stagePage<D>(
  root: ShadowRoot,
  page: Page<D>,
  got: Loaded<D>,
  kind: Kind = kindHere() ?? 'overview',
  nav?: HTMLElement,
  heard: Heard[] = [],
) {
  stage = { root, kind, heard };
  listen();
  const render = (d: D) => hearing(heard, () => page.render(d));
  if (!('data' in got)) return waitFor(root, got.pending, render, () => page.load(), nav);
  // its data is there already: drawn at once (the view may not be in the document yet: LuCI puts it in after this)
  const el = render(got.data);
  if (nav) el.querySelector(':scope > .dl-nav')?.replaceWith(nav);
  const was = pageIn(root);
  if (was) was.replaceWith(el);
  else root.append(el);
  enter(el);
}

/** The page on screen goes: who listens is told, what it put on the window and the document is taken off. */
function leave(s: Stage) {
  document.dispatchEvent(new CustomEvent(LEAVE));
  for (const l of s.heard) l.target.removeEventListener(l.type, l.fn, l.opts);
  s.heard = [];
}

/** Open the page at `to` in the place of the one on screen; `push`: as a new step of the history. False: not ours. */
function open(to: string, push: boolean): boolean {
  const s = stage;
  if (!s || !make || !s.root.host.isConnected) return false;
  const url = new URL(to, location.href);
  const place = placeOf(url);
  const kind = place && KIND[place.view];
  if (!place || !kind) return false;
  const address = new URL(href(place), location.href);
  address.hash = url.hash;
  if (push) {
    // the same address: nothing to open
    if (address.href === location.href) return true;
    history.pushState(null, '', address.href);
  }
  leave(s);
  const nav = s.root.querySelector<HTMLElement>('.dl-nav') ?? undefined;
  if (nav) markSection(nav, place);
  const heard: Heard[] = [];
  const page = hearing(heard, () => make![kind]());
  scroller().scrollTop = 0;
  stagePage(s.root, page, { pending: page.load() }, kind, nav, heard);
  return true;
}

/** Links to Dawnline's other pages, `visit()` and Back / Forward between them, taken here; once. */
function listen() {
  if (listening) return;
  listening = true;
  // a press on a link anywhere in the page (the page's own moves are taken by the page first: they prevent it)
  document.addEventListener('click', (e) => {
    const s = stage;
    if (!s || !s.root.host.isConnected || e.defaultPrevented || !plain(e)) return;
    const path = e.composedPath();
    if (!path.includes(s.root)) return;
    const a = path.find((x): x is HTMLAnchorElement => x instanceof HTMLAnchorElement && !!x.href);
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (open(a.href, true)) e.preventDefault();
  });
  // Back and Forward: a step between two pages is taken here; one inside a page (its parts, a sheet) is the page's own
  addEventListener('popstate', (e) => {
    const s = stage;
    if (!s || !s.root.host.isConnected || (e.state as { sheet?: boolean } | null)?.sheet) return;
    const kind = kindHere();
    if (kind && kind !== s.kind) open(location.href, false);
  });
  shellVisits((url) => open(url, true));
}
