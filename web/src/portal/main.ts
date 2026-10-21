// Dawnline personal portal: one person's devices and access, served by the
// router on its own HTTPS port. No framework; strict CSP (no inline scripts or
// styles). This module boots the page, loads the state and draws it; the page's
// parts live in page/, what its buttons start in flows/, the moving parts in ui/.
//
// Layout: no navbar, a breadcrumb on top. Phone: "Your access" first, devices
// under it; desktop (≥ 960px): devices left, access right and sticky.

// First: the translation globals, before anything draws.
import { onLang } from './i18n';
import { put, h } from './dom';
import { EASE_OUT, play, publishSprings } from './motion';
import { gone, call } from './api';
import { base, code, onRepaint, placeName, setState, state, type RepaintOpts, type State } from './state';
import { setupFromHash, wantsAdd } from './setup';
import { frame, crumbs, single } from './page/frame';
import { fillNotice, stateNotice } from './page/notices';
import { devicesNow, devicesSection, fillDevices } from './page/devices';
import { accessSection, fillAccess } from './page/access';
import { glass, type Tone } from './ui/glass';
import { closeMenu, menuOpen } from './ui/menu';
import { closeSheet, sheetOpen } from './ui/sheet';
import { renaming } from './flows/rename';
import { startAdd } from './flows/add';
import { openSetup } from './flows/setup-view';

publishSprings(document.documentElement);
const app = document.getElementById('app')!;

let parts: { notice: HTMLElement; devices: HTMLElement; access: HTMLElement } | null = null;
let booted = false;
/** How the page was last drawn: what a language change draws again. */
let redraw: () => void = () => {};

/** The first paint comes in: the blocks rise one after the other, the sun rises behind its line. */
function intro() {
  // In the order they stand on screen, top to bottom and then left to right: on a phone "Your access" comes before the devices.
  const blocks = [...app.querySelectorAll('.crumbs, .notice, .sec-head, .dgrid > *, .note-s:not([hidden]), .acc-slot .acc-row, .gone')]
    .map((el) => ({ el, at: el.getBoundingClientRect() }))
    .sort((a, b) => Math.round(a.at.top) - Math.round(b.at.top) || a.at.left - b.at.left);
  const els = blocks.map((x) => x.el);
  // The wave starts at the first block on screen (a reload goes back deep into the page): those above it rise with it.
  const above = blocks.filter((x) => x.at.bottom <= 0).length;
  // Each block rises to its own opacity: a card the admin disabled is dimmed all the way, not at the end.
  const own = els.map((el) => getComputedStyle(el).opacity);
  els.forEach((el, i) =>
    play(
      el,
      [
        { opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' },
        { opacity: own[i], transform: 'none', filter: 'none' },
      ],
      {
        duration: 520,
        delay: 60 + Math.max(0, i - above) * 40,
        easing: EASE_OUT,
        fill: 'backwards',
      },
    ),
  );
  app.querySelectorAll('.logo .sun').forEach((s) =>
    play(s, [{ transform: 'translateY(7px)' }, { transform: 'none' }], {
      duration: 900,
      delay: 150,
      easing: EASE_OUT,
      fill: 'backwards',
    }),
  );
  booted = true;
}

/**
 * Draw the page from the state. The parts stay; a repaint refills them: cards
 * that stay glide to their new places, the open access row stays open.
 */
function render(o: RepaintOpts = {}) {
  const st = state();
  if (!st) return;
  redraw = render;
  // Paused by the admin: nothing on the page works until it is resumed, so the page is the one card that says so.
  if (st.person.state === 'paused') {
    document.title = placeName();
    const [icon, title, text] = stateNotice(st.person);
    return only(icon, title, text, false, 'orange');
  }
  const slot = frame(app);
  single(false);
  crumbs();
  document.title = placeName();
  // Safari lays the page out once with the new cards still empty (each is a size container, devices.css) and
  // pulls the scroll up to fit that shorter page; a language change empties it all. The content keeps its height
  // while it is refilled, and lets go once everything in it has its styles.
  slot.style.minHeight = `${slot.offsetHeight}px`;
  const fresh = !parts;
  if (!parts) {
    parts = { notice: h('div', { class: 'notice-slot' }), devices: devicesSection(), access: accessSection() };
    put(slot, parts.notice, h('div', { class: 'cols' }, parts.devices, parts.access));
  }
  // Where the cards stand before anything above them changes: the notice and, on a phone, "Your access" move them too.
  const devices = devicesNow(parts.devices);
  // What stops the devices comes first.
  fillNotice(parts.notice, st.person, !fresh);
  fillAccess(parts.access, st);
  fillDevices(parts.devices, st, o, devices);
  slot.getBoundingClientRect();
  slot.style.minHeight = '';
  if (!booted) {
    const y = keptPlace();
    if (y) scrollTo(0, y);
    intro();
  }
}
onRepaint(render);

/*
 * A phone drops a tab while the visitor is in another app (the VPN app, the App Store) and loads it again on
 * return; a pull to refresh loads it again too. The browser puts the page back where it was as it loads, before
 * the router has answered: the page is one empty screen then, so it stays at the top. The tab keeps the page's
 * place itself, and the first paint of a reload (or of a step back onto the page) goes back there; a fresh visit
 * to the link still opens at the top. Each link keeps its own (several people's links opened in one tab share the
 * origin), and only the page drawn in its place has one: hidden before the router answered, or showing a card in
 * place of the page, the tab keeps the place it had.
 */
const PLACE = `dl.y:${location.pathname}`;
function keepPlace() {
  if (!parts) return;
  try {
    sessionStorage.setItem(PLACE, String(Math.round(scrollY)));
  } catch {
    // No storage (a private window that refuses it): a reload opens at the top.
  }
}
function keptPlace(): number {
  const how = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  if (how !== 'reload' && how !== 'back_forward') return 0;
  try {
    return Number(sessionStorage.getItem(PLACE)) || 0;
  } catch {
    return 0;
  }
}
addEventListener('pagehide', keepPlace);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) keepPlace();
});

/** A card in place of the page: the link stopped working, nothing could load, or the access is paused. */
function only(icon: string, title: string, text: string, gone = false, tone: Tone = 'grey') {
  parts = null;
  const slot = frame(app);
  single(true);
  crumbs(gone, true);
  put(slot, h('div', { class: 'gone' }, glass(icon, tone), h('h1', {}, title), h('p', {}, text)));
  if (!booted) intro();
}

/** The link stopped working (code regenerated, person removed): nothing else is left. */
function linkGone() {
  setState(null);
  closeSheet(true);
  redraw = linkGone;
  only('key', _('This link no longer works'), _('Ask for a new one.'), true);
}

/** Nothing could load: the reason as the router or the browser gave it. */
function notLoaded(why: string) {
  redraw = () => notLoaded(why);
  only('server', _('The page could not load'), why);
}

/**
 * A link that names a device (`#setup=d_…`, the code a set-up sheet hands to
 * that device) opens its set-up at once, if it still waits for one; `#add`
 * opens "Add a device". On load, or when such a link opens in a tab already on
 * this page. Once: the fragment comes off the address (a reload shows the page).
 */
function openFromLink() {
  const st = state();
  const id = setupFromHash(location.hash);
  const add = wantsAdd(location.hash);
  if (!st || (!id && !add)) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (add) return startAdd();
  const d = st.person.devices.find((x) => x.id === id);
  // Its own link: the page is open on that device.
  if (d && !d.handshake && !d.disabled && !st.locked) void openSetup(d, null, true);
}
addEventListener('hashchange', openFromLink);

async function refresh() {
  try {
    setState(await call<State>('state'));
    // Not under an open sheet or menu, nor a name being edited on its card.
    if (!sheetOpen() && !menuOpen() && !renaming()) render();
    openFromLink();
  } catch (e) {
    if (gone(e)) linkGone();
    // A network hiccup: keep showing the last state (the page loads fresh data on reload).
    else if (!state()) notLoaded((e as Error).message);
  }
}

// Another language: everything is drawn again in it, the sections too (their headings are text).
onLang(() => {
  closeMenu(true);
  parts = null;
  redraw();
});

// What the keyboard does never animates.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuOpen()) closeMenu(true);
  else if (sheetOpen()) closeSheet(true);
});

// No periodic refresh: every portal request runs a CGI process on the router.
// The page reloads its data after the visitor's own changes and while it waits
// for a new device's first connection.
if (!base || !code) linkGone();
else void refresh();
