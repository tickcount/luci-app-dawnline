// Dawnline personal portal: one person's devices, served by the router on
// its own HTTPS port. No framework; strict CSP (no inline scripts/styles).
//
// Layout: phone = "Your access" on top, devices below; desktop (≥ 960px) =
// devices on the left, access on the right.

import type { ClientConfig, Device, Kind, Person } from '../shared/types';
import {
  ACCESS_LABEL,
  KIND_LABEL,
  addDays,
  ago,
  byDeviceState,
  bytes,
  date,
  daysLeft,
  endsIn,
  endsSoon,
  initials,
  isoDay,
  parseDay,
} from '../shared/format';
import { iconSvg } from '../shared/icons';
import { denseQr, qrSvg } from '../shared/qr';
import { vpnKey } from '../shared/vpnkey';
import { h, ic, type Kid } from './dom';
import { waitPath, type Way } from './waitpath';
import {
  beat,
  busy,
  calm,
  copied,
  fold,
  followHeight,
  intro,
  leave,
  pullToClose,
  replay,
  restyle,
  settle,
  slider,
  snap,
  swap,
} from './motion';
import {
  APP_NAME,
  appsFor,
  hereLabel,
  deviceNoun,
  importPath,
  setupFromHash,
  setupLink,
  inWebview,
  osGroup,
  PLATFORM_LABEL,
  platformOf,
  routerStore,
  sameDevice,
  scanPath,
  storeFor,
  updateLine,
  type AppId,
  type Platform,
  type Preset,
  type Store,
} from './setup';

interface State {
  title: string;
  person: Person;
  /** device_mesh: devices with home access reach each other through the tunnel. */
  /** awg_disguise: false = plain WireGuard, any WireGuard app connects. */
  server: { name: string; endpoint: string; device_mesh?: boolean; awg_disguise?: boolean; preset?: Preset };
  /** The device this page was opened from (through the tunnel), if any. */
  here?: string | null;
  can_add: boolean;
  /** The admin stopped the person (paused, access ended): the page only shows. */
  locked?: boolean;
  /** Over plain HTTP: the same link over HTTPS, where the connection settings are. */
  https_url?: string | null;
  kinds: Kind[];
  version: string;
  /** The router's day (YYYY-MM-DD) when it sends one; the browser's otherwise. */
  today?: string;
  /** The router's clock (epoch seconds): relative times are measured against it, not the phone's. */
  now?: number;
}

/** Today on the router, for days left and chart labels. */
const today = () => state?.today ?? isoDay(new Date());
/** Now on the router (seconds), for "last connected 3 min ago". */
const now = () => state?.now ?? Date.now() / 1000;

const app = document.getElementById('app')!;
const base = app.dataset.base ?? '';
const pageTitle = app.dataset.title || 'Dawnline';
const isMobile = () => window.matchMedia('(max-width: 959px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
let state: State | null = null;
/** The personal link is the key: its path is the code (no sessions). */
const code = /^\/[a-z]{6}-[a-z]{6}-[a-z]{6}$/.test(base) ? base.slice(1) : '';

/* ---------- API ---------- */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The HTTPS twin of this link, when the answer was "not over plain HTTP". */
    public httpsUrl?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.https_url || undefined);
  return data as T;
}

/* ---------- small UI pieces ---------- */

/** One toast at a time: a new one sends the last away first. */
let toastEl: HTMLElement | null = null;
function dropToast(t: HTMLElement) {
  if (toastEl === t) toastEl = null;
  t.classList.remove('show');
  t.classList.add('gone');
  setTimeout(() => t.remove(), 200);
}

function toast(msg: string, bad = false) {
  if (toastEl) dropToast(toastEl);
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.appendChild(t);
  void t.offsetWidth;
  t.classList.add('show');
  toastEl = t;
  setTimeout(() => dropToast(t), 2600);
}

/** `from`: the control that copied, which then shows a check for a moment. */
async function copy(text: string, what = 'Copied', from?: EventTarget | null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'offscreen' }, text) as HTMLTextAreaElement;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return toast('Copying is blocked here. Select the text and copy it by hand.', true);
  }
  copied(from instanceof HTMLElement ? from : null, iconSvg('check', 'ic-svg'));
  toast(what);
}

/**
 * On phones a share sheet hands the file straight to the VPN app, where a
 * download would land in Files. Returns the action, or null where files
 * cannot be shared.
 */
function shareFile(cfg: ClientConfig): (() => Promise<void>) | null {
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  // Desktop browsers claim they can share files and then do nothing, or open a
  // sheet with nowhere useful: there a download is the right thing anyway.
  if (!/Android|iPhone|iPad/.test(navigator.userAgent)) return null;
  if (typeof nav.share !== 'function' || typeof File === 'undefined') return null;
  const file = new File([cfg.conf], cfg.filename, { type: 'application/octet-stream' });
  if (!nav.canShare?.({ files: [file] })) return null;
  return async () => {
    try {
      await nav.share({ files: [file], title: cfg.filename });
    } catch (e) {
      // Cancelled: nothing to do. Refused by the browser: the file still has to get out.
      if ((e as Error)?.name !== 'AbortError') download(cfg.filename, cfg.conf);
    }
  };
}

function download(name: string, text: string) {
  // Not text/plain: Safari would save "name.conf.txt".
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, class: 'offscreen' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

// One tooltip for the page: it fades in where the pointer is, then only follows it
// (moving from bar to bar never replays the entrance).
let tipEl: HTMLElement | null = null;
function tip(el: HTMLElement, lines: () => string[]) {
  const show = (ev: MouseEvent) => {
    tipEl ??= document.body.appendChild(h('div', { class: 'tip', role: 'tooltip' }));
    tipEl.replaceChildren(...lines().map((l, i) => h('div', { class: i ? 'muted' : 'tip-title' }, l)));
    tipEl.style.left = `${ev.clientX}px`;
    tipEl.style.top = `${ev.clientY - 10}px`;
    tipEl.classList.add('show');
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', () => tipEl?.classList.remove('show'));
}

function spark(values: number[]): HTMLElement {
  const max = Math.max(1, ...values);
  const el = h('div', { class: 'spark' });
  values.forEach((v, i) => {
    const b = h('i', { class: v ? '' : 'zero' });
    b.style.height = `${Math.max(8, (v / max) * 100)}%`;
    b.style.setProperty('--i', String(i));
    const back = values.length - 1 - i;
    tip(b, () => [
      back === 0
        ? 'Today'
        : back === 1
          ? 'Yesterday'
          : parseDay(addDays(today(), -back)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      bytes(v),
    ]);
    el.appendChild(b);
  });
  return el;
}

/** Run a confirmed action once: its button stays disabled until the router answers. */
async function once(btn: HTMLButtonElement, fn: () => Promise<void>) {
  if (btn.disabled) return;
  btn.disabled = true;
  const idle = busy(btn);
  try {
    await fn();
  } finally {
    idle();
    btn.disabled = false;
  }
}

/* ---------- sheets (bottom sheet on phones, dialog on desktop) ---------- */

let sheetEl: HTMLElement | null = null;
let sheetClosed: (() => void) | null = null;
/** The sheet sits at the bottom (phones): it slides up and can be pulled down. */
const bottomSheet = () => window.matchMedia('(max-width: 639px)').matches;

// A sheet is a history entry: the phone's back button closes it instead of leaving the page.
let sheetHistory = false;
window.addEventListener('popstate', () => {
  if (sheetEl) {
    sheetHistory = false;
    closeSheet();
  }
});

/** `immediate`: gone at once (Escape: what the keyboard does never animates). */
function closeSheet(immediate = false) {
  if (!sheetEl) return;
  const s = sheetEl;
  sheetEl = null;
  if (sheetHistory) {
    sheetHistory = false;
    history.back();
  }
  document.body.classList.remove('locked');
  sheetClosed?.();
  sheetClosed = null;
  if (immediate) {
    s.remove();
    return;
  }
  s.classList.remove('open');
  s.classList.add('closing');
  setTimeout(() => s.remove(), bottomSheet() ? 320 : 180);
}

/**
 * Open a sheet with this content, or turn the open one into it: the panel then
 * keeps its place (and its history entry) while the old content fades out, the
 * new one comes in and the size follows, so a flow of sheets reads as one.
 * `asks`: the narrow question look (ask), which the panel also morphs out of.
 */
function present(label: string, inner: Node[], asks = false) {
  if (sheetEl) {
    sheetClosed?.();
    sheetClosed = null;
    const panel = sheetEl.querySelector('.sheet-panel') as HTMLElement;
    panel.setAttribute('aria-label', label);
    panel.setAttribute('role', asks ? 'alertdialog' : 'dialog');
    // A question that turns into a sheet (or back) changes width too: let the panel morph it.
    if (panel.classList.contains('asks') !== asks) {
      panel.dataset.morph = 'width';
      panel.classList.toggle('asks', asks);
    }
    panel.scrollTop = 0;
    swap(panel.querySelector('.sheet-inner') as HTMLElement, inner);
    return;
  }
  const box = h('div', { class: 'sheet-inner' }, ...inner);
  const panel = h(
    'div',
    { class: `sheet-panel${asks ? ' asks' : ''}`, role: asks ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-label': label },
    h('div', { class: 'grab' }),
    box,
  );
  const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
  const s = h('div', { class: 'sheet fresh' }, scrim, panel);
  // On a dialog the content settles in just after it; on phones the slide is the motion.
  box
    .querySelectorAll<HTMLElement>(':scope > .sheet-head, .sheet-body > :not(.setup), .setup > *')
    .forEach((el, i) => el.style.setProperty('--i', String(Math.min(i, 6))));
  document.body.appendChild(s);
  document.body.classList.add('locked');
  if (!sheetHistory) {
    try {
      history.pushState({ sheet: true }, '');
      sheetHistory = true;
    } catch {
      /* no history */
    }
  }
  followHeight(panel, box);
  pullToClose(panel, scrim, () => closeSheet(), bottomSheet);
  void s.offsetWidth;
  s.classList.add('open');
  setTimeout(() => s.classList.remove('fresh'), 700);
  sheetEl = s;
}

/** A sheet: a title (and a line under it), a close button, the content. */
function sheet(title: string, sub: string | null, ...content: Kid[]) {
  present(title, [
    h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'stack' }, h('h2', {}, title), sub ? h('span', { class: 'muted s' }, sub) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeSheet() }, ic('x')),
    ),
    h('div', { class: 'sheet-body' }, ...content),
  ]);
}

/**
 * A question before something that cannot be undone (Remove, New keys): narrow
 * and centred, the action's icon in its colour, one line of what happens, Cancel
 * and the action (no ×: Cancel says it). `run` holds the action's button busy.
 */
function ask(o: {
  icon: string;
  tone: 'bad' | 'warn';
  title: string;
  text: string;
  action: string;
  actionClass: string;
  run: () => Promise<void>;
}) {
  present(
    o.title,
    [
      h(
        'div',
        { class: 'ask' },
        h('span', { class: `ask-ic ${o.tone}` }, ic(o.icon)),
        h('h2', {}, o.title),
        h('p', { class: 'muted' }, o.text),
        h(
          'div',
          { class: 'row gap ask-actions' },
          h('button', { type: 'button', class: 'btn block', onclick: () => closeSheet() }, 'Cancel'),
          h(
            'button',
            {
              type: 'button',
              class: `btn ${o.actionClass} block`,
              onclick: (ev: Event) => once(ev.currentTarget as HTMLButtonElement, o.run),
            },
            o.action,
          ),
        ),
      ),
    ],
    true,
  );
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu(true);
    closeSheet(true);
  }
});

/* ---------- dropdown menu ---------- */

let menuEl: HTMLElement | null = null;
/** The button the open menu belongs to: pressing it again closes the menu. */
let menuFor: HTMLElement | null = null;

/** `immediate`: gone at once (Escape). */
function closeMenu(immediate = false) {
  const m = menuEl;
  if (!m) return;
  menuEl = null;
  menuFor?.setAttribute('aria-expanded', 'false');
  menuFor = null;
  if (immediate) {
    m.remove();
    return;
  }
  m.classList.remove('show');
  m.classList.add('gone');
  setTimeout(() => m.remove(), 150);
}
document.addEventListener('click', (e) => {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
});

function menu(anchor: HTMLElement, all: ({ label: string; icon: string; danger?: boolean; run: () => unknown } | null)[]) {
  if (menuFor === anchor) return closeMenu();
  closeMenu();
  // Separators only between items.
  const items = all.filter((it, i) => it || (i > 0 && all[i - 1] && all.slice(i + 1).some(Boolean)));
  const m = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      it
        ? h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: `menu-item${it.danger ? ' danger' : ''}`,
              onclick: () => {
                closeMenu();
                it.run();
              },
            },
            ic(it.icon),
            h('span', {}, it.label),
          )
        : h('div', { class: 'menu-sep' }),
    ),
  );
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = 230,
    mh = m.offsetHeight;
  // Under the button, or over it where the screen ends: it grows out of the button either way.
  const up = r.bottom + 6 + mh > window.innerHeight - 8 && r.top - 6 - mh > 8;
  m.classList.toggle('up', up);
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${(up ? r.top - 6 - mh : r.bottom + 6) + window.scrollY}px`;
  void m.offsetWidth;
  m.classList.add('show');
  anchor.setAttribute('aria-expanded', 'true');
  menuEl = m;
  menuFor = anchor;
}

/* ---------- views ---------- */

// The sun rises from behind the horizon once, on the visit's first paint.
const LOGO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="dl-sky"><rect width="24" height="17"/></clipPath></defs>' +
  '<g clip-path="url(#dl-sky)"><path class="sun" d="M3 15a9 9 0 0 1 18 0z" fill="currentColor"/></g>' +
  '<rect x="2" y="17" width="20" height="2" rx="1" fill="currentColor" opacity=".45"/></svg>';

/** The blocks of a page that come in on the first paint, in reading order. */
const INTRO = '.alert, .hello, .card-head, .access-card, .dcard, .slot.add, .firststeps, .devices > .faint, .signin, .wrap > .card';
let booted = false;

/**
 * Draw the page. The visit's first paint comes in (blocks rise in, the meters
 * fill, the sun rises); a repaint only moves what changed: keyed blocks glide
 * to their new places, new ones rise in, changed values come into focus.
 */
function shell(...content: Kid[]) {
  const before = booted ? snap(app) : null;
  const first = !booted ? ' first' : '';
  const wrap = h('main', { class: `wrap${first}` }, ...content);
  app.replaceChildren(
    h(
      'header',
      { class: `top${first}` },
      h(
        'div',
        { class: 'brand' },
        (() => {
          const l = h('span', { class: 'logo' });
          l.innerHTML = LOGO;
          return l;
        })(),
        h('span', {}, state?.server.name || pageTitle),
        h('span', { class: 'faint' }, '· Dawnline'),
      ),
    ),
    wrap,
  );
  if (before) settle(app, before);
  else intro(wrap, INTRO);
  booted = true;
}

/** The link stopped working while the page was open (code regenerated, person removed). */
function linkGone() {
  shell(
    h(
      'div',
      { class: 'card signin', 'data-key': 'gone' },
      h('div', { class: 'hero-ic' }, ic('key')),
      h('h1', {}, 'This link no longer works'),
      h('p', { class: 'muted' }, 'Ask for a new personal link.'),
    ),
  );
}

/** Why the person's devices can't connect: icon, title and what happens next. */
function stateNotice(p: Person): [string, string, string] {
  switch (p.state) {
    case 'server_off':
      return ['server', 'The server is turned off', 'Your devices can’t connect until the admin turns it on again.'];
    case 'no_server':
      return ['server', 'No server yet', 'Ask the admin to add you to a server.'];
    case 'quota':
      return ['chart', 'You have used all your data', 'Your devices stay connected but nothing gets through until it resets.'];
    case 'expired':
      return ['calendar', 'Your access has ended', 'Ask the admin to extend it.'];
    case 'hours':
      return [
        'clock',
        'Outside your hours',
        `Access is available ${p.hours.replace('-', '–')} (router time); until then nothing gets through.`,
      ];
    default:
      return ['pause', 'Your access is paused by the admin', 'Your devices can’t connect until the admin resumes it.'];
  }
}

/** A notice in the admin's Overview style: a tinted icon tile, a title and a line under it. */
function alertRow(tone: string, icon: string, title: string, sub: string): HTMLElement {
  return h(
    'div',
    { class: 'alert', 'data-key': 'notice' },
    h('span', { class: `alert-ic ${tone}` }, ic(icon)),
    h('div', { class: 'stack' }, h('span', { class: 'strong' }, title), h('span', { class: 'muted s' }, sub)),
  );
}

function stateTone(p: Person) {
  return p.state === 'active' ? 'ok' : p.state === 'quota' || p.state === 'expired' ? 'bad' : 'warn';
}

const ACCESS_TEXT: Record<Person['access'], string> = {
  internet: 'The internet, through the router',
  lan: 'Devices at home',
  both: 'Devices at home and the internet, through the router',
};

function accessCard(st: State): HTMLElement {
  const p = st.person;
  const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
  const bar = h('div', { class: `meter${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` }, h('i'));
  (bar.firstChild as HTMLElement).style.width = `${pct}%`;
  if (p.quota_limit) tip(bar, () => [`${pct.toFixed(1)}% used`, `${bytes(Math.max(0, p.quota_limit - p.quota_used))} left`]);
  const left = daysLeft(p.expires, today());
  const slots = h('div', { class: 'slots' });
  // Devices the admin added over the limit get their own orange slots after the allowed ones.
  for (let i = 0; i < Math.max(p.device_limit, p.devices.length); i++)
    slots
      .appendChild(h('i', { class: i >= p.device_limit ? 'over' : i < p.devices.length ? 'used' : '' }))
      .style.setProperty('--i', String(i));
  const used = p.quota_used || p.month[0] + p.month[1];
  const icon = p.access === 'internet' ? 'globe' : p.access === 'lan' ? 'home' : 'shield';
  // Heading outside the card, like "Your devices", so both columns line up.
  return h(
    'section',
    { class: 'access', 'aria-label': 'Your access', 'data-key': 'access' },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'row-baseline' }, h('h2', {}, 'Your access'), h('span', { class: 'faint s' }, 'set by the admin')),
    ),
    h(
      'div',
      { class: 'card access-card' },
      h(
        'div',
        { class: 'reach' },
        h('span', { class: 'reach-ic' }, ic(icon)),
        h(
          'div',
          { class: 'stack' },
          h('span', { class: 'strong' }, ACCESS_LABEL[p.access]),
          h('span', { class: 'muted s' }, ACCESS_TEXT[p.access]),
        ),
      ),
      namesAtHome(p, !!st.server.device_mesh),
      h(
        'div',
        { class: 'tile' },
        h(
          'div',
          { class: 'tile-label' },
          h('span', {}, p.quota_period === 'total' && p.quota_gb ? 'Data used' : 'Data this month'),
          p.quota_period === 'month' ? h('span', {}, 'resets on the 1st') : null,
        ),
        h(
          'span',
          { class: 'tile-value', 'data-v': 'used' },
          bytes(used),
          h('span', { class: 'faint' }, p.quota_limit ? ` of ${bytes(p.quota_limit)}` : ' · no limit'),
        ),
        p.quota_limit ? bar : null,
      ),
      h(
        'div',
        { class: 'tiles2' },
        h(
          'div',
          { class: 'tile' },
          h('div', { class: 'tile-label' }, 'Devices'),
          h(
            'span',
            { class: 'tile-value', 'data-v': 'count' },
            String(p.devices.length),
            h('span', { class: 'faint' }, ` / ${p.device_limit}`),
          ),
          slots,
        ),
        h(
          'div',
          { class: 'tile' },
          h('div', { class: 'tile-label' }, 'Access until'),
          h('span', { class: 'tile-value sm', 'data-v': 'until' }, p.expires ? date(p.expires) : 'No end date'),
          left != null
            ? h(
                'span',
                { class: `s ${endsSoon(p, left) ? 'warn' : 'ok'}` },
                left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'ended',
              )
            : null,
        ),
      ),
      h(
        'span',
        { class: 'faint s' },
        p.hours ? `Available ${p.hours.replace('-', '–')} (router time). Need a change? Ask the admin.` : 'Need a change? Ask the admin.',
      ),
    ),
  );
}

function deviceStatus(d: Device, p: Person): HTMLElement {
  // Status as coloured text, no dots (only the avatar carries one).
  if (d.disabled) return h('span', { class: 'dstat' }, 'Disabled by the admin');
  // Settings the device carries changed: it keeps working on the old ones only until they stop matching.
  if (d.config_stale && d.handshake) return h('span', { class: 'dstat warn' }, 'Settings changed, update needed');
  // Over the data limit or outside the hours the tunnel stays up but passes nothing: the app says
  // "connected", so say here why nothing works.
  if (d.online && p.state === 'quota') return h('span', { class: 'dstat warn' }, 'Connected, no data left');
  if (d.online && p.state === 'hours') return h('span', { class: 'dstat warn' }, 'Connected, outside your hours');
  if (d.online) return h('span', { class: 'dstat ok' }, 'Connected');
  if (!d.handshake) return h('span', { class: 'dstat warn' }, 'Not set up yet');
  return h('span', { class: 'dstat', title: new Date(d.handshake * 1000).toLocaleString() }, `Last connected ${ago(d.handshake, now())}`);
}

/**
 * How other devices at home reach this person's devices: once, in the access card,
 * instead of an address on every device card. Only with access to the home network.
 */
/**
 * Whether the home network can open connections to this device: the router lets
 * it through only for people with home access who are active, and devices on.
 */
function reachableFromHome(p: Person, d: Device): boolean {
  return p.access !== 'internet' && p.state === 'active' && !d.disabled;
}

function namesAtHome(p: Person, mesh: boolean): HTMLElement | null {
  const named = byDeviceState(p.devices).filter((d) => d.hostname && reachableFromHome(p, d));
  if (!named.length) return null;
  const first = named[0].hostname;
  const domain = first.slice(first.indexOf('.'));
  return h(
    'div',
    { class: 'names' },
    h(
      'div',
      { class: 'names-head' },
      h('span', { class: 'names-ic' }, ic('home')),
      h(
        'div',
        { class: 'stack' },
        h('span', { class: 'strong s' }, 'Names at home'),
        h(
          'span',
          { class: 'faint s' },
          mesh ? 'Devices at home and on this VPN reach yours as ' : 'Other devices at home reach yours as ',
          h('span', { class: 'mono' }, `name${domain}`),
        ),
      ),
    ),
    h(
      'div',
      { class: 'names-list' },
      named.map((d) => {
        const dot = d.hostname.indexOf('.');
        return h(
          'button',
          {
            type: 'button',
            class: 'name-chip',
            title: d.name,
            'aria-label': `Copy ${d.hostname}`,
            onclick: (ev: Event) => copy(d.hostname, 'Address copied', ev.currentTarget),
          },
          h(
            'span',
            { class: 'mono' },
            dot > 0 ? [d.hostname.slice(0, dot), h('span', { class: 'faint' }, d.hostname.slice(dot))] : d.hostname,
          ),
          ic('copy'),
        );
      }),
    ),
  );
}

function deviceCard(d: Device, st: State): HTMLElement {
  const more = h(
    'button',
    { type: 'button', class: 'icon-btn soft', 'aria-label': `${d.name} options`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    ic('more'),
  );
  more.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu(more, [
      { label: 'Show QR code', icon: 'qr', run: () => connect(d, 'qr') },
      { label: 'Copy AmneziaVPN key', icon: 'key', run: () => copyKey(d) },
      { label: 'Download .conf', icon: 'download', run: () => downloadConf(d) },
      null,
      // How devices at home reach it: only where the router actually lets them through.
      ...(reachableFromHome(st.person, d)
        ? [
            { label: 'Copy IP address', icon: 'copy', run: () => copy(d.address, 'IP address copied') },
            ...(d.hostname ? [{ label: 'Copy local address', icon: 'home', run: () => copy(d.hostname, 'Address copied') }] : []),
            null,
          ]
        : []),
      // A device the admin turned off can't be renamed, rekeyed or removed here (the router refuses).
      ...(d.disabled
        ? []
        : [
            { label: 'Rename', icon: 'edit', run: () => rename(d) },
            { label: 'New keys', icon: 'reset', run: () => rotateKeys(d, st) },
            { label: 'Remove', icon: 'trash', danger: true, run: () => removeDevice(d) },
          ]),
    ]);
  });
  const week = d.spark.reduce((a, b) => a + b, 0);
  const setUp = !d.handshake && !d.disabled;
  // Stopped by the admin: no actions, and a device never set up has nothing to show.
  const locked = !!st.locked;
  // The device this page was opened from (through the tunnel): blue, and says so.
  const here = st.here === d.id;
  // Opened through the tunnel, so it is connected: say which one it is instead.
  // The home name is in the access card; the tunnel address says nothing to them.
  const status = here ? h('span', { class: 'dstat here' }, 'This device') : deviceStatus(d, st.person);
  status.dataset.v = `stat:${d.id}`;
  return h(
    'article',
    { class: `dcard${d.online ? ' online' : ''}${d.disabled ? ' off' : ''}${here ? ' here' : ''}`, 'data-key': d.id },
    h(
      'div',
      { class: 'dhead' },
      h('span', { class: 'dic' }, ic(d.kind)),
      h('div', { class: 'stack grow' }, h('span', { class: 'dname', 'data-v': `name:${d.id}` }, d.name), status),
      locked ? null : more,
    ),
    setUp && locked
      ? null
      : setUp
        ? [
            h(
              'button',
              { type: 'button', class: 'btn primary block', onclick: () => setup(d) },
              ic('arrow'),
              h('span', {}, `Set up ${d.name}`),
            ),
          ]
        : h(
            'div',
            { class: 'duse' },
            h(
              'div',
              { class: 'stack' },
              h('span', { class: 'faint s' }, 'Last 7 days'),
              h('span', { class: 'mono', 'data-v': `week:${d.id}` }, bytes(week)),
            ),
            spark(d.spark),
          ),
    // The admin changed something the configuration carries: the status line says so, one button fixes it.
    d.config_stale && !setUp && !locked
      ? h(
          'button',
          { type: 'button', class: 'btn block', onclick: () => connect(d) },
          ic('refresh'),
          h('span', {}, 'Update the connection'),
        )
      : null,
  );
}

function main(st: State) {
  const p = st.person;
  const left = daysLeft(p.expires, today());
  const notice =
    p.state !== 'active'
      ? alertRow(stateTone(p), ...stateNotice(p))
      : endsSoon(p, left)
        ? alertRow('warn', 'calendar', `Your access ${endsIn(left as number)}`, `On ${date(p.expires)}. Ask the admin to extend it.`)
        : null;

  // The device this page was opened from comes first.
  const order = byDeviceState(p.devices).sort((a, b) => Number(b.id === st.here) - Number(a.id === st.here));
  const cards: HTMLElement[] = order.map((d) => deviceCard(d, st));
  const free = st.locked ? 0 : Math.max(0, p.device_limit - p.devices.length);
  // Nothing yet: one card with the button; the set-up sheet behind it walks through the app and the connection.
  if (!p.devices.length && free) {
    cards.push(
      h(
        'div',
        { class: 'card firststeps', 'data-key': 'first' },
        h('h2', {}, 'Add your first device'),
        h(
          'p',
          { class: 'muted' },
          'Two steps, about a minute: get the app, then add the connection. The next screen shows both for the device you pick.',
        ),
        h(
          'button',
          { type: 'button', class: 'btn primary block big', onclick: addDevice },
          ic('plus'),
          h('span', {}, isMobile() ? 'Add this phone' : 'Add this device'),
        ),
      ),
    );
  } else if (free)
    cards.push(
      h(
        'button',
        { type: 'button', class: 'slot add', onclick: addDevice, 'data-key': 'add' },
        h('span', { class: 'slot-ic' }, ic('plus')),
        // How many are left is in "Your devices 3 of 10" and the Devices tile.
        h('span', { class: 'strong' }, 'Add device'),
      ),
    );

  const devices = h(
    'section',
    { class: 'devices', 'aria-label': 'Your devices' },
    h(
      'div',
      { class: 'card-head', 'data-key': 'devices-head' },
      h(
        'div',
        { class: 'row-baseline' },
        // How many (the Devices tile) and which are online (the cards) are shown already.
        h('h2', {}, 'Your devices'),
      ),
    ),
    h('div', { class: 'dgrid' }, cards),
    st.locked
      ? null
      : [
          !st.can_add
            ? h(
                'span',
                { class: 'faint s', 'data-key': 'limit' },
                `You have reached your limit of ${p.device_limit} devices. Remove one or ask the admin for more.`,
              )
            : null,
        ],
  );

  // What stops the devices comes before the greeting.
  shell(
    notice,
    h(
      'div',
      { class: 'hello', 'data-key': 'hello' },
      h('span', { class: `avatar${p.online ? ' online' : ''}` }, initials(p.name)),
      // What is wrong is in the notice above, not a pill here.
      h('h1', {}, `Hi, ${p.name}`),
    ),
    h('div', { class: 'layout' }, accessCard(st), devices),
  );
}

/** Where to get the app on this platform: the store on phones, the downloads page elsewhere. */
function appLink(): { href: string; label: string } {
  const pf = platform();
  const st = storeFor('vpn', pf);
  return {
    href: st?.href ?? 'https://github.com/amnezia-vpn/amnezia-client/releases/latest',
    label: `Get AmneziaVPN${pf === 'ios' ? ' for iPhone' : pf === 'android' ? ' for Android' : ''}`,
  };
}

/** The platform this page is open on (iPad on Safari says Mac; touch points tell). */
const platform = (): Platform => platformOf(navigator.userAgent, navigator.maxTouchPoints);
/** The server's disguise generation, for which apps and versions connect. */
const preset = (): Preset => state?.server.preset ?? (plainWg() ? 'off' : 'max');

/** The server's disguise is off: plain WireGuard, so any WireGuard app connects. */
const plainWg = () => state?.server.awg_disguise === false;

/* ---------- QR codes ---------- */

// The portal draws its codes in the night look (light dots on a black card).
// Some in-app scanners read only dark on light: one line under every code
// switches all of them to the plain look, and the choice is remembered here.
const QR_LIGHT = 'dl.qr.light';
let lightQr = (() => {
  try {
    return localStorage.getItem(QR_LIGHT) === '1';
  } catch {
    return false;
  }
})();
/** What each drawn code encodes, to draw it again in the other look. */
const qrText = new WeakMap<HTMLElement, string>();

function paintQr(q: HTMLElement, text: string) {
  qrText.set(q, text);
  // A dense code is drawn as large as the sheet allows: a phone camera needs the modules.
  q.className = `qr${denseQr(text) ? ' big' : ''}${lightQr ? ' light' : ''}`;
  q.innerHTML = qrSvg(text, 3, true, lightQr ? 'plain' : 'night');
}

/** "Not scanning? Show a light code", or the way back. */
function paintFlip(line: HTMLElement) {
  line.replaceChildren(
    lightQr ? '' : 'Not scanning? ',
    h(
      'a',
      {
        href: '#',
        onclick: (ev: Event) => {
          ev.preventDefault();
          flipQr();
        },
      },
      lightQr ? 'Show the dark code' : 'Show a light code',
    ),
  );
}
function qrFlip(): HTMLElement {
  const line = h('span', { class: 'faint s qr-flip' });
  paintFlip(line);
  return line;
}

function flipQr() {
  lightQr = !lightQr;
  try {
    localStorage.setItem(QR_LIGHT, lightQr ? '1' : '0');
  } catch {
    /* private mode: for this page only */
  }
  document.querySelectorAll<HTMLElement>('.qr').forEach((q) => {
    const text = qrText.get(q);
    if (!text) return;
    paintQr(q, text);
    replay(q, 'swap');
  });
  document.querySelectorAll<HTMLElement>('.qr-flip').forEach(paintFlip);
}

/* ---------- device flows ---------- */

/**
 * A plain-HTTP link (an IP address) shows the page, but keys only travel
 * encrypted: the connection settings are on the HTTPS twin. Its certificate
 * is the router's own, so the browser warns once; say so.
 */
function secureSheet(url: string) {
  sheet(
    'Open the link securely',
    'Connection settings only travel encrypted',
    h(
      'div',
      { class: 'stack gap' },
      h('p', { class: 'muted' }, 'This page is open without encryption. To add or set up a device, open the same link over HTTPS:'),
      h('a', { class: 'btn primary block big', href: url }, ic('lock'), h('span', {}, 'Open securely')),
      h(
        'p',
        { class: 'faint s' },
        'The browser may warn that the certificate is not trusted: it is this router’s own. Choose to continue (“Advanced” → “Proceed”).',
      ),
    ),
  );
}

/** The secure twin when this page is plain HTTP, else null. */
const httpsTwin = () => state?.https_url || null;

async function getConfig(d: Device): Promise<ClientConfig | null> {
  const twin = httpsTwin();
  if (twin) {
    secureSheet(twin);
    return null;
  }
  try {
    return await call<ClientConfig>(`devices/${d.id}/config`);
  } catch (e) {
    const er = e as ApiError;
    if (er.httpsUrl) secureSheet(er.httpsUrl);
    else toast(er.message, true);
    return null;
  }
}

async function copyKey(d: Device) {
  const cfg = await getConfig(d);
  if (cfg) copy(await vpnKey(cfg, `${cfg.server} · ${cfg.name}`), 'Key copied');
}

async function downloadConf(d: Device) {
  const cfg = await getConfig(d);
  if (cfg) download(cfg.filename, cfg.conf);
}

/** Connection sheet: open-in-app / QR / key / file, plus live status. */
/** One configuration line, highlighted; private and preshared keys masked unless shown. */
function confLine(line: string, reveal: boolean): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return h('span', { class: 'conf-sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)\s*(.*)$/.exec(line);
  if (!m) return document.createTextNode(line);
  const secret = /^(\s*)(PrivateKey|PresharedKey)\b/.test(line);
  return h(
    'span',
    {},
    h('span', { class: 'conf-k' }, m[1]),
    ' ',
    secret ? (reveal ? h('span', { class: 'conf-v' }, m[2]) : h('span', { class: 'conf-mask' }, '••••••••••••••••')) : m[2],
  );
}

/** The .conf as a file card (download) and a folded, highlighted view with copy and a hidden key. */
function filePane(cfg: ClientConfig): HTMLElement {
  let reveal = false;
  const pre = h('pre', { class: 'conf' });
  // A key shown comes into focus out of a blur; hidden again, the mask fades back.
  const paint = (toggled = false) => {
    pre.replaceChildren(...cfg.conf.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l, reveal)] : [confLine(l, reveal)])));
    if (toggled) pre.querySelectorAll('.conf-v, .conf-mask').forEach((el) => el.classList.add('unmask'));
  };
  const eye = h(
    'button',
    {
      class: 'btn small',
      onclick: (ev: Event) => {
        ev.preventDefault();
        reveal = !reveal;
        eye.replaceChildren(ic(reveal ? 'x' : 'key'), h('span', {}, reveal ? 'Hide key' : 'Show key'));
        replay(eye, 'swap');
        paint(true);
      },
    },
    ic('key'),
    h('span', {}, 'Show key'),
  );
  paint();
  return h(
    'div',
    { class: 'pane' },
    h(
      'div',
      { class: 'filecard' },
      h('span', { class: 'filecard-ic' }, '.conf'),
      h(
        'span',
        { class: 'stack' },
        h('span', { class: 'mono ellipsis' }, cfg.filename),
        h(
          'span',
          { class: 'faint s' },
          plainWg()
            ? 'For computers and routers: import it in any WireGuard app'
            : 'For computers and routers: import it in AmneziaWG or AmneziaVPN',
        ),
      ),
      shareFile(cfg)
        ? h('button', { class: 'btn primary', onclick: () => shareFile(cfg)!() }, ic('open'), h('span', {}, 'Share file'))
        : h('button', { class: 'btn primary', onclick: () => download(cfg.filename, cfg.conf) }, ic('download'), h('span', {}, 'Download')),
    ),
    h(
      'details',
      { class: 'confbox' },
      h(
        'summary',
        {},
        ic('chevron'),
        h('span', {}, 'Configuration'),
        h('span', { class: 'grow' }),
        eye,
        h(
          'button',
          {
            class: 'btn small',
            onclick: (ev: Event) => {
              ev.preventDefault();
              copy(cfg.conf, 'Configuration copied', ev.currentTarget);
            },
          },
          ic('copy'),
          h('span', {}, 'Copy'),
        ),
      ),
      pre,
    ),
  );
}

async function connect(d: Device, initial?: 'app' | 'qr' | 'key' | 'file', cfgIn?: ClientConfig) {
  const cfg = cfgIn ?? (await getConfig(d));
  if (!cfg) return;
  const key = await vpnKey(cfg, `${cfg.server} · ${cfg.name}`);
  const mobile = isMobile();
  // What is being set up decides what comes first: a phone from a phone opens
  // the app, a phone seen from a computer shows the code, a computer or
  // router takes the file.
  const handheld = d.kind === 'phone' || d.kind === 'tablet';
  const panes: Record<string, () => HTMLElement> = {
    app: () =>
      h(
        'div',
        { class: 'pane' },
        h('a', { class: 'btn primary block big', href: key }, ic('amnezia'), h('span', {}, 'Open in AmneziaVPN')),
        h(
          'ol',
          { class: 'steps' },
          h(
            'li',
            {},
            'No AmneziaVPN yet? ',
            h('a', { href: appLink().href, target: '_blank', rel: 'noopener noreferrer' }, appLink().label),
            '.',
          ),
          h('li', {}, 'Tap ', h('b', {}, 'Open in AmneziaVPN'), ' and confirm the import.'),
          h('li', {}, 'Turn the connection on — this page shows ', h('span', { class: 'ok' }, 'Connected'), ' within a minute.'),
        ),
      ),
    qr: () => {
      // Two codes: AmneziaVPN reads its own key (the phone's camera opens it in
      // the app); the AmneziaWG and WireGuard apps read the configuration text.
      const q = h('div', { class: 'qr' });
      const cap = h('p', { class: 'muted s' });
      const seg = h('div', { class: 'seg' });
      let mode: 'vpn' | 'conf' = plainWg() ? 'conf' : 'vpn';
      let glide = () => {};
      // The other code comes into focus where the last one was.
      const paint = (switched = false) => {
        const text = mode === 'vpn' ? key : cfg.conf;
        // A dense code is drawn as large as the sheet allows: a phone camera needs the modules.
        paintQr(q, text);
        cap.textContent =
          mode === 'vpn'
            ? 'Scan with the phone’s camera or inside AmneziaVPN.'
            : plainWg()
              ? 'Scan inside the AmneziaWG, WireGuard or AmneziaVPN app.'
              : 'Scan inside the AmneziaWG app (or AmneziaVPN).';
        seg.querySelectorAll<HTMLElement>(':scope > button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
        glide();
        if (switched) {
          replay(q, 'swap');
          replay(cap, 'swap');
        }
      };
      for (const [m, label] of [
        ['vpn', 'AmneziaVPN'],
        ['conf', plainWg() ? 'WireGuard app' : 'AmneziaWG app'],
      ] as const)
        seg.appendChild(
          h(
            'button',
            {
              type: 'button',
              'data-m': m,
              onclick: () => {
                if (mode === m) return;
                mode = m;
                paint(true);
              },
            },
            label,
          ),
        );
      paint();
      glide = slider(seg);
      return h('div', { class: 'pane center' }, seg, q, cap, qrFlip());
    },
    key: () =>
      h(
        'div',
        { class: 'pane' },
        h('p', { class: 'muted s' }, 'In AmneziaVPN choose “Add server → Insert key”.'),
        h(
          'div',
          { class: 'keybox' },
          h('span', { class: 'mono' }, key),
          h('button', { class: 'btn small', onclick: (ev: Event) => copy(key, 'Key copied', ev.currentTarget) }, 'Copy'),
        ),
        h('p', { class: 'faint s' }, 'Keep it private: anyone with the key can use your connection.'),
      ),
    file: () => filePane(cfg),
  };
  const order = mobile && handheld ? ['app', 'qr', 'key', 'file'] : handheld ? ['qr', 'key', 'file'] : ['file', 'key', 'qr'];
  const labels: Record<string, string> = { app: 'Open in app', qr: 'QR code', key: 'Key', file: 'File' };
  const body = h('div', { class: 'tab-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  // The highlight slides to the tab; its pane comes in from that side.
  let current = -1;
  let glide = () => {};
  const show = (id: string) => {
    const i = order.indexOf(id);
    tabs.querySelectorAll<HTMLElement>(':scope > button').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === id);
      b.setAttribute('aria-selected', String(b.dataset.id === id));
    });
    glide();
    if (current < 0) body.replaceChildren(panes[id]());
    else if (i !== current) swap(body, [panes[id]()], Math.sign(i - current));
    current = i;
  };
  for (const id of order) tabs.appendChild(h('button', { role: 'tab', 'data-id': id, onclick: () => show(id) }, labels[id]));
  show(initial && order.includes(initial) ? initial : order[0]);
  glide = slider(tabs);

  // Never connected: the way to the router waits on top, and once it fills the
  // code and the file have done their job and leave. Connected before: one line.
  const way = d.handshake || d.disabled ? null : waitPath(d.kind);
  const stop = way ? watchFirstConnection(d, () => void arrive(way, [tabs, body]), way.gaveUp) : () => undefined;
  sheet(
    d.handshake ? `Connect ${d.name}` : `${d.name} is ready`,
    mobile && handheld
      ? 'Add it to AmneziaVPN on this phone'
      : handheld
        ? 'Scan with the phone’s camera or AmneziaVPN'
        : 'Import the file in AmneziaWG or AmneziaVPN',
    way?.el,
    tabs,
    body,
    d.handshake ? liveLine(d) : null,
  );
  sheetClosed = () => {
    stop();
    if (state) main(state);
  };
}

/** How a device that connected before is doing: one line under the sheet. */
function liveLine(d: Device): HTMLElement {
  return h(
    'div',
    { class: 'waiting' },
    d.online ? h('span', { class: 'ok' }, 'Connected') : h('span', { class: 'muted' }, `Last connected ${ago(d.handshake, now())}`),
  );
}

/**
 * The first connection arrived. The way fills green (the sheet goes back up to
 * it if it was scrolled) and says so; then everything under it, which did its
 * job, folds shut like an accordion while the sheet's edge comes up with it.
 * Two seconds to read the way, and the sheet closes by itself onto the page
 * (repainted, see catchUp).
 */
async function arrive(way: Way, rest: HTMLElement[]) {
  way.connected();
  way.el.closest('.sheet-panel')?.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' });
  await beat(400);
  await Promise.all(rest.map((el) => fold(el)));
  // Reading time, not motion: the same with less motion.
  await new Promise((r) => setTimeout(r, 2000));
  // Only this sheet: not one the visitor went on to (a swap leaves the way in a ghost).
  if (sheetEl?.contains(way.el) && !way.el.closest('.ghost')) closeSheet();
}

/**
 * The first connection was seen (a fresh handshake) before the agent's watcher
 * marked the device online, a second at most: ask again shortly, a few times,
 * and repaint the page with the answer (unless a sheet or menu is open; closing
 * it repaints), so the card goes on to "Connected" instead of staying on
 * "Last connected just now".
 */
function catchUp(id: string, tries = 4) {
  window.setTimeout(async () => {
    try {
      const st = await call<State>('state');
      state = st;
      if (!sheetEl && !menuEl) main(st);
      if (!st.person.devices.find((x) => x.id === id)?.online && tries > 1) catchUp(id, tries - 1);
    } catch {
      /* a hiccup: the page keeps the last answer, as on load */
    }
  }, 1500);
}

/**
 * Poll for the first connection of a device that never connected: 5 s at
 * first, then slower, for ten minutes at most (then `gaveUp`), not while the
 * tab is hidden (every poll is a process on the router), and never again once
 * the link stopped working. `arrived` runs once. Returns the stop function.
 */
function watchFirstConnection(d: Device, arrived: () => void, gaveUp: () => void): () => void {
  // The first connection is a handshake newer than this sheet (router clock), not `online`:
  // that follows the agent's watcher, which can lag the handshake by a poll, and a device
  // set up again with new keys still reports the last handshake of its old ones.
  const opened = now();
  let timer = 0,
    polls = 0,
    done = false;
  const started = Date.now();
  const poll = async () => {
    timer = 0;
    if (done) return;
    if (Date.now() - started > 600_000) {
      done = true;
      gaveUp();
      return;
    }
    if (document.hidden) {
      schedule();
      return;
    }
    try {
      const st = await call<State>('state');
      state = st;
      const dev = st.person.devices.find((x) => x.id === d.id);
      if (dev && dev.handshake > opened) {
        done = true;
        arrived();
        if (!dev.online) catchUp(d.id);
        return;
      }
    } catch (e) {
      if ((e as ApiError).status === 404 || (e as ApiError).status === 401) {
        done = true;
        return;
      }
    }
    polls++;
    schedule();
  };
  const schedule = () => {
    if (!done && !timer) timer = window.setTimeout(poll, polls < 6 ? 5000 : polls < 12 ? 15000 : 30000);
  };
  const onVisible = () => {
    if (!document.hidden && !done && !timer) void poll();
  };
  document.addEventListener('visibilitychange', onVisible);
  schedule();
  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/* ---------- setting up a device: get the app, add the connection ---------- */

/** The app a device was set up with last time, so the sheet reopens on it. */
const APP_MEMO = (d: Device) => `dl.app.${d.id}`;
function recallApp(d: Device): AppId | null {
  try {
    const v = localStorage.getItem(APP_MEMO(d));
    return v === 'vpn' || v === 'awg' || v === 'wg' ? v : null;
  } catch {
    return null;
  }
}
function rememberApp(d: Device, app: AppId) {
  try {
    localStorage.setItem(APP_MEMO(d), app);
  } catch {
    /* private mode */
  }
}

const APP_ICON: Record<AppId, string> = { vpn: 'amnezia', awg: 'amneziawg', wg: 'wireguard' };

/**
 * A store badge: the mark in a tile, two lines, a chevron. `primary` = the one thing to tap.
 * `key` names it across repaints, so a badge that now says something else comes into focus.
 */
function badge(
  st: { href?: string; top: string; main: string; mark: string; onclick?: (ev: Event) => void },
  primary = false,
  key?: string,
): HTMLElement {
  const inner = [
    h('span', { class: 'badge-ic' }, ic(st.mark)),
    h('span', { class: 'badge-txt' }, h('span', { class: 'badge-top' }, st.top), h('span', { class: 'badge-main' }, st.main)),
    h('span', { class: 'badge-chev' }, ic('chevron')),
  ];
  const cls = `badge${primary ? ' primary' : ''}`;
  return st.onclick
    ? h('button', { type: 'button', class: cls, onclick: st.onclick, 'data-m': key }, inner)
    : h(
        'a',
        { class: cls, href: st.href, target: st.href?.startsWith('vpn:') ? null : '_blank', rel: 'noopener noreferrer', 'data-m': key },
        inner,
      );
}

/** Choice pills: an icon and a label each, one on. `group` keys them across repaints. */
function pills(group: string, items: { id: string; label: string; icon?: string; on: boolean; pick: () => void }[]): HTMLElement {
  return h(
    'div',
    { class: 'pills' },
    items.map((it) =>
      h(
        'button',
        { type: 'button', class: `pill${it.on ? ' on' : ''}`, onclick: it.pick, 'data-m': `${group}:${it.id}` },
        it.icon ? ic(it.icon) : null,
        h('span', {}, it.label),
      ),
    ),
  );
}

/** The step card: a numbered head and its content. */
const step = (n: string, title: Kid, ...content: Kid[]) =>
  h(
    'div',
    { class: 'step' },
    h('div', { class: 'step-head' }, h('span', { class: 'step-n' }, n), h('span', { class: 'step-title' }, title)),
    ...content,
  );

/** A link as text with Copy and, where the browser has one, the share sheet. */
function linkRow(url: string): HTMLElement {
  const share = typeof navigator.share === 'function';
  return h(
    'div',
    { class: 'linkrow' },
    h('span', { class: 'mono ellipsis' }, url.replace(/^https?:\/\//, '')),
    h('button', { type: 'button', class: 'btn small', onclick: (ev: Event) => copy(url, 'Link copied', ev.currentTarget) }, 'Copy'),
    share
      ? h(
          'button',
          {
            type: 'button',
            class: 'icon-btn soft',
            'aria-label': 'Share the link',
            onclick: () => navigator.share({ url, title: state?.title ?? 'Dawnline' }).catch(() => undefined),
          },
          ic('share'),
        )
      : null,
  );
}

/**
 * Set up a device: one sheet, two numbered steps. Which app and where it comes
 * from follow the server's disguise and the platform the page is open on; a
 * device set up from another device gets its link (and code) to take there.
 */
async function setup(d: Device, cfgIn?: ClientConfig) {
  const cfg = cfgIn ?? (await getConfig(d));
  if (!cfg) return;
  const key = await vpnKey(cfg, `${cfg.server} · ${cfg.name}`);
  const apps = appsFor(preset());
  const pf = platform();
  const same = sameDevice(d.kind, pf);
  const handheld = d.kind === 'phone' || d.kind === 'tablet';
  const router = d.kind === 'router';
  const hereHandheld = pf === 'ios' || pf === 'android';
  const osChoices = osGroup(d.kind);
  let app: AppId = recallApp(d) ?? (router ? 'awg' : 'vpn');
  if (!apps.some((a) => a.id === app)) app = router ? 'awg' : 'vpn';
  // Which system a computer runs is the person's call; the browser's guess comes first.
  let os: Platform = osChoices.length ? (osChoices.includes(pf) ? pf : 'windows') : pf;
  let picker = false,
    away = false,
    open: 'link' | 'app' = 'app',
    entered: string | null = null;
  const body = h('div', { class: 'setup' });
  const way = waitPath(d.kind);
  // The title names the device; the lines under it say "the phone".
  const there = deviceNoun(d.kind);
  // The device connected: the instructions are leaving, no repaint brings them back.
  let finished = false;

  const appOf = (id: AppId) => apps.find((a) => a.id === id) ?? apps[0];
  const appPills = () =>
    pills(
      'app',
      apps
        .filter((a) => !router || a.id !== 'vpn')
        .map((a) => ({
          id: a.id,
          label: a.name,
          icon: APP_ICON[a.id],
          on: a.id === app,
          pick: () => {
            app = a.id;
            rememberApp(d, app);
            paint();
          },
        })),
    );
  const osPills = () =>
    pills(
      'os',
      osChoices.map((o) => ({
        id: o,
        label: o === pf ? hereLabel(o) : PLATFORM_LABEL[o],
        icon: o === 'windows' ? 'windows' : o === 'mac' ? 'apple' : 'linux',
        on: o === os,
        pick: () => {
          os = o;
          paint();
        },
      })),
    );
  const storeBlock = (): Kid[] => {
    const st: Store | null = router ? routerStore(app) : storeFor(app, os);
    if (!st) return [h('span', { class: 'muted s' }, `Get ${APP_NAME[app]} on the ${PLATFORM_LABEL[os]} and come back here.`)];
    return [
      st.alt
        ? [
            h('div', { class: 'badges2' }, badge(st, false, 'store'), badge(st.alt, false, 'store-alt')),
            h('span', { class: 'faint s' }, st.alt.why),
          ]
        : badge(st, false, 'store'),
      updateLine(appOf(app)) ? h('span', { class: 'faint s', 'data-m': 'update' }, updateLine(appOf(app))) : null,
    ];
  };
  const getStep = () =>
    step(
      '1',
      [
        h('span', { class: 'grow', 'data-m': 'get' }, `Get ${APP_NAME[app]}`),
        apps.length > 1 && !picker
          ? h(
              'button',
              {
                type: 'button',
                class: 'pill-link',
                onclick: () => {
                  picker = true;
                  entered = 'picker';
                  paint();
                },
              },
              h('span', {}, 'Another app'),
              ic('chevron'),
            )
          : null,
      ],
      picker
        ? h(
            'div',
            { class: `stack gap${entered === 'picker' ? ' enter' : ''}` },
            appPills(),
            h('span', { class: 'faint s', 'data-m': 'app-sub' }, appOf(app).sub),
          )
        : null,
      osChoices.length ? osPills() : null,
      ...storeBlock(),
    );

  // Step 2 follows the app and the device: a link for AmneziaVPN, the file for the others.
  const connectStep = () => {
    const name = APP_NAME[app];
    if (app === 'vpn' && hereHandheld)
      return step(
        '2',
        'Add the connection',
        badge({ href: key, top: 'Then come back here and tap', main: 'Open in AmneziaVPN', mark: 'amnezia' }, true, 'connect'),
        h(
          'span',
          { class: 'faint s' },
          'Nothing opened? ',
          h('a', { href: '#', onclick: (ev: Event) => (ev.preventDefault(), copy(key, 'Key copied', ev.currentTarget)) }, 'Copy the key'),
          ' and add it in the app.',
        ),
      );
    if (app === 'vpn')
      return step(
        '2',
        'Add the connection',
        badge(
          {
            top: 'The connection as one key',
            main: 'Copy the key',
            mark: 'copy',
            onclick: (ev) => copy(key, 'Key copied', ev.currentTarget),
          },
          true,
          'connect',
        ),
        h(
          'ol',
          { class: 'howto', 'data-m': 'howto' },
          h('li', {}, 'Open AmneziaVPN'),
          h('li', {}, 'Add server → ', h('b', {}, 'Insert key')),
          h('li', {}, 'Paste the key and connect'),
        ),
        h('span', { class: 'faint s' }, 'Have the app open? ', h('a', { href: key }, 'Open in AmneziaVPN')),
      );
    const share = hereHandheld ? shareFile(cfg) : null;
    return step(
      '2',
      'Add the connection',
      share
        ? badge({ top: `Straight into ${name}`, main: 'Share the file', mark: 'share', onclick: () => share() }, true, 'connect')
        : badge(
            {
              top: 'Then import it in the app',
              main: 'Download the file',
              mark: 'download',
              onclick: () => download(cfg.filename, cfg.conf),
            },
            true,
            'connect',
          ),
      h(
        'ol',
        { class: 'howto', 'data-m': 'howto' },
        h('li', {}, `Open ${name}`),
        h('li', {}, importPath(app).replace(/ → .*$/, ' → '), h('b', {}, importPath(app).replace(/^.* → /, ''))),
        h('li', {}, share ? 'Confirm the import and connect' : 'Pick the file and connect'),
      ),
    );
  };

  /**
   * Two cards that hold codes, one open at a time: a folded card's head is the
   * button that opens it (and folds the other); the open card's head is just a head.
   */
  const foldHead = (id: 'link' | 'app', ...title: Kid[]) =>
    open === id
      ? h('div', { class: 'step-head open', 'data-m': `fold:${id}` }, ...title)
      : h(
          'button',
          {
            type: 'button',
            class: 'step-head fold',
            'aria-expanded': 'false',
            'data-m': `fold:${id}`,
            onclick: () => {
              open = id;
              entered = id;
              paint();
            },
          },
          ...title,
          h('span', { class: 'fold-chev' }, ic('chevron')),
        );
  // A code keyed by what it encodes: one that now holds something else comes into focus.
  const qrOf = (mark: string, text: string) => {
    const q = h('div', { 'data-m': mark, 'data-sig': `${text.length}:${text.slice(-24)}` });
    paintQr(q, text);
    return q;
  };

  /** What a card just unfolded comes in one piece after the other. */
  const unfolded = (now: boolean, kids: (HTMLElement | null)[]) => {
    if (now)
      kids
        .filter((k): k is HTMLElement => !!k)
        .forEach((k, i) => {
          k.classList.add('unfold');
          k.style.setProperty('--i', String(i));
        });
    return kids;
  };

  // Not on the device: the link goes there (as a code for a phone's camera), the rest happens there.
  // It names the device, so the page there opens straight on its set-up.
  const linkThere = setupLink(location.origin + location.pathname, d.id);
  const awayCard = (easiest = false, fold = false) =>
    h(
      'div',
      { class: `step${fold && open !== 'link' ? ' folded' : ''}` },
      fold
        ? foldHead(
            'link',
            h('span', { class: 'step-title grow' }, `Open your link on the ${there}`),
            easiest ? h('span', { class: 'chip', 'data-glide': 'easiest' }, 'Easiest') : null,
          )
        : h(
            'div',
            { class: 'step-head' },
            h('span', { class: 'step-title grow' }, `Open your link on the ${there}`),
            easiest ? h('span', { class: 'chip' }, 'Easiest') : null,
          ),
      ...(fold && open !== 'link'
        ? []
        : unfolded(entered === 'link', [
            h('span', { class: 'muted s step-sub' }, 'The same page there does both steps for that device.'),
            handheld
              ? h(
                  'div',
                  { class: 'code-row' },
                  qrOf('link-qr', linkThere),
                  h(
                    'span',
                    { class: 'stack gap' },
                    h('span', { class: 'muted s' }, 'Point its camera at the code: the link opens there.'),
                    qrFlip(),
                  ),
                )
              : null,
            linkRow(linkThere),
          ])),
    );
  const awayFold = () =>
    away
      ? (() => {
          const c = awayCard();
          if (entered === 'away') c.classList.add('enter');
          return c;
        })()
      : h(
          'div',
          { class: 'center' },
          h(
            'button',
            {
              type: 'button',
              class: 'fold-link',
              onclick: () => {
                away = true;
                entered = 'away';
                paint();
              },
            },
            `Not on the ${there} right now?`,
          ),
        );

  // A phone set up from a computer: the link as a code, or the connection as a code for a phone that has the app.
  const appCodeCard = () =>
    h(
      'div',
      { class: `step${open !== 'app' ? ' folded' : ''}` },
      foldHead('app', h('span', { class: 'step-ic' }, ic(APP_ICON[app])), h('span', { class: 'step-title grow' }, 'Already has the app')),
      ...(open !== 'app'
        ? []
        : unfolded(entered === 'app', [
            apps.length > 1 ? h('div', {}, appPills()) : null,
            h(
              'div',
              { class: 'code-row' },
              qrOf('app-qr', app === 'vpn' ? key : cfg.conf),
              h(
                'span',
                { class: 'stack' },
                h('span', { class: 'muted s' }, `In ${APP_NAME[app]}: `, h('b', {}, scanPath(app)), '. The connection is added at once.'),
                updateLine(appOf(app)) ? h('span', { class: 'faint s' }, updateLine(appOf(app))) : null,
                qrFlip(),
              ),
            ),
            h(
              'span',
              { class: 'faint s' },
              'Prefer the file or the key? ',
              h('a', { href: '#', onclick: (ev: Event) => (ev.preventDefault(), connect(d, 'file', cfg)) }, 'Connection details'),
            ),
          ])),
    );

  const paint = () => {
    if (finished) return;
    const parts: Kid[] = [];
    if (inWebview(navigator.userAgent))
      parts.push(
        h(
          'div',
          { class: 'notice' },
          ic('alert'),
          h('span', { class: 'grow' }, 'Open this page in Safari or Chrome: the store opens from here, but the app handoff does not.'),
        ),
      );
    if (same) parts.push(getStep(), connectStep(), awayFold());
    else if (router)
      parts.push(
        step(
          '1',
          [h('span', { class: 'grow', 'data-m': 'get' }, `Get ${APP_NAME[app]} on the router`)],
          apps.length > 2 ? appPills() : null,
          badge(routerStore(app), false, 'store'),
        ),
        step('2', 'Import the configuration', filePane(cfg)),
      );
    else if (handheld) parts.push(awayCard(true, true), appCodeCard());
    else
      parts.push(
        h('span', { class: 'muted s' }, `The app goes on the ${there}. Which one is it?`),
        osPills(),
        awayCard(true),
        step(
          '',
          [h('span', { class: 'grow', 'data-m': 'get' }, `${APP_NAME[app]} for ${PLATFORM_LABEL[os]}`)],
          h('span', { class: 'faint s' }, 'Or download the installer here and move it to the PC'),
          ...storeBlock(),
        ),
        h(
          'span',
          { class: 'faint s center' },
          `Already has ${APP_NAME[app]}? `,
          h('a', { href: '#', onclick: (ev: Event) => (ev.preventDefault(), copy(key, 'Key copied', ev.currentTarget)) }, 'Copy the key'),
        ),
      );
    restyle(body, () => body.replaceChildren(...parts.flat().filter((x): x is Node => x instanceof Node)));
    entered = null;
  };
  paint();
  const stop = watchFirstConnection(
    d,
    () => {
      finished = true;
      void arrive(way, [body]);
    },
    way.gaveUp,
  );
  sheet(`Set up ${d.name}`, same ? 'Two steps, about a minute' : router ? 'The packages and the file for OpenWrt' : null, way.el, body);
  sheetClosed = () => {
    stop();
    if (state) main(state);
  };
}

function rename(d: Device) {
  const name = h('input', { type: 'text', value: d.name, maxlength: 48, 'aria-label': 'Device name' }) as HTMLInputElement;
  const save = h('button', { class: 'btn primary block', type: 'submit' }, 'Save') as HTMLButtonElement;
  sheet(
    `Rename ${d.name}`,
    null,
    h(
      'form',
      {
        class: 'stack gap',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void once(save, async () => {
            try {
              const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'rename', name: name.value });
              state = r.state;
              closeSheet();
              main(state);
              toast('Renamed');
            } catch (er) {
              toast((er as Error).message, true);
            }
          });
        },
      },
      name,
      save,
    ),
  );
  setTimeout(() => name.select(), 50);
}

/** New keys for a device: the old configuration stops working, the new one is shown right away. */
function rotateKeys(d: Device, st: State) {
  ask({
    icon: 'key',
    tone: 'warn',
    title: `New keys for ${d.name}?`,
    text:
      st.here === d.id
        ? 'This device is connected through its current settings: it disconnects a few seconds after you confirm. Import the new ones that open next.'
        : 'Its current settings stop working. Set it up again with the new ones that open next.',
    action: 'New keys',
    actionClass: 'primary',
    run: async () => {
      try {
        const r = await call<{ config: ClientConfig; state: State }>(`devices/${d.id}`, { action: 'rotate' });
        state = r.state;
        main(state);
        await setup({ ...d, handshake: 0 }, r.config);
      } catch (er) {
        toast((er as Error).message, true);
      }
    },
  });
}

function removeDevice(d: Device) {
  ask({
    icon: 'trash',
    tone: 'bad',
    title: `Remove ${d.name}?`,
    text: 'Its connection stops working at once. You can add it again later.',
    action: 'Remove',
    actionClass: 'danger-solid',
    run: async () => {
      try {
        const r = await call<{ state: State }>(`devices/${d.id}`, { action: 'delete' });
        state = r.state;
        closeSheet();
        // The card goes first; the rest then glide into its place.
        await leave(app.querySelector(`[data-key="${CSS.escape(d.id)}"]`));
        main(state);
        toast('Device removed');
      } catch (er) {
        toast((er as Error).message, true);
      }
    },
  });
}

// Best guess at the device this page is open on (the browser never tells its real name).
const UA = navigator.userAgent;
const IPAD = /iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);

function guessKind(): Kind {
  if (IPAD || /Tablet/i.test(UA) || (/Android/.test(UA) && !/Mobile/.test(UA))) return 'tablet';
  if (/Android|iPhone|Mobile/i.test(UA)) return 'phone';
  return 'computer';
}

/** Samsung model codes → names people know (S and A series; the code stays in brackets). */
const GALAXY: [RegExp, string][] = [
  [/^SM-S93/, 'Galaxy S25'],
  [/^SM-S92/, 'Galaxy S24'],
  [/^SM-S91/, 'Galaxy S23'],
  [/^SM-S90/, 'Galaxy S22'],
  [/^SM-G99/, 'Galaxy S21'],
  [/^SM-F9/, 'Galaxy Z Fold'],
  [/^SM-F7/, 'Galaxy Z Flip'],
  [/^SM-A5/, 'Galaxy A5x'],
  [/^SM-A3/, 'Galaxy A3x'],
  [/^SM-X/, 'Galaxy Tab'],
];

/** Android model from Client Hints (Chrome); filled in shortly after the page loads. */
let MODEL = '';
const modelReady: Promise<string> = (async () => {
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ model?: string }> } })
    .userAgentData;
  if (!uad || !/Android/.test(UA)) return '';
  try {
    const m = ((await uad.getHighEntropyValues(['model'])).model ?? '').trim();
    if (!m || m === 'K') return '';
    const g = GALAXY.find(([re]) => re.test(m));
    MODEL = g ? `${g[1]} (${m})` : /^SM-/.test(m) ? `Galaxy ${m}` : m;
  } catch {
    /* not offered */
  }
  return MODEL;
})();

function guessName(kind: Kind): string {
  if (/iPhone/.test(UA)) return 'iPhone';
  if (IPAD) return 'iPad';
  if (/Android/.test(UA)) return MODEL || (kind === 'tablet' ? 'Android tablet' : 'Android phone');
  if (/CrOS/.test(UA)) return 'Chromebook';
  if (/Mac OS X/.test(UA)) return 'Mac';
  if (/Windows/.test(UA)) return 'Windows PC';
  if (/Linux/.test(UA)) return 'Linux PC';
  return KIND_LABEL[kind];
}

function addDevice() {
  if (!state) return;
  const twin = httpsTwin();
  if (twin) {
    secureSheet(twin);
    return;
  }
  let kind: Kind = guessKind();
  const taken = new Set(state.person.devices.map((d) => d.name.toLowerCase()));
  const suggest = (k: Kind) => {
    const n = k === guessKind() ? guessName(k) : KIND_LABEL[k];
    if (!taken.has(n.toLowerCase())) return n;
    for (let i = 2; i < 20; i++) if (!taken.has(`${n} ${i}`.toLowerCase())) return `${n} ${i}`;
    return n;
  };
  const name = h('input', {
    type: 'text',
    value: suggest(kind),
    maxlength: 48,
    'aria-label': 'Device name',
    required: true,
  }) as HTMLInputElement;
  let edited = false;
  name.addEventListener('input', () => (edited = true));
  // The Android model arrives a moment later: use it unless they started typing.
  modelReady.then(() => {
    if (!edited && kind === guessKind()) name.value = suggest(kind);
  });
  const kinds = h(
    'div',
    { class: 'kinds' },
    (state.kinds as Kind[]).map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: `kind${k === kind ? ' on' : ''}`,
          'data-k': k,
          onclick: () => {
            kind = k;
            kinds.querySelectorAll('.kind').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === k));
            if (!edited) name.value = suggest(k);
          },
        },
        ic(k),
        h('span', {}, KIND_LABEL[k]),
      ),
    ),
  );
  const err = h('p', { class: 'err' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Create connection') as HTMLButtonElement;
  sheet(
    'Add a device',
    `${state.person.device_limit - state.person.devices.length} of ${state.person.device_limit} slots free`,
    h(
      'form',
      {
        class: 'add',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          submit.disabled = true;
          const idle = busy(submit);
          err.textContent = '';
          try {
            const r = await call<{ id: string; config: ClientConfig; state: State }>('devices', { name: name.value.trim(), kind });
            state = r.state;
            const dev = r.state.person.devices.find((d) => d.id === r.id)!;
            await setup(dev, r.config);
          } catch (er) {
            if ((er as ApiError).httpsUrl) {
              secureSheet((er as ApiError).httpsUrl as string);
              return;
            }
            err.textContent = (er as Error).message;
            replay(err, 'enter');
            submit.disabled = false;
          } finally {
            idle();
          }
        },
      },
      h('label', { class: 'lbl' }, 'What is it?'),
      kinds,
      h('p', { class: 'muted s' }, 'Phones and tablets get a smaller packet size that suits mobile networks.'),
      h('label', { class: 'lbl' }, 'Name'),
      name,
      err,
      submit,
    ),
  );
}

/* ---------- boot ---------- */

/**
 * A link that names a device (`#setup=d_…`: the code and the link a set-up
 * sheet hands to that device) opens its set-up at once, if it still waits for
 * one: on load, or when the link is opened in a tab already on this page.
 * Once: the fragment comes off the address (a reload shows the page).
 */
window.addEventListener('hashchange', () => openFromLink());
function openFromLink() {
  const id = setupFromHash(location.hash);
  if (!id) return;
  history.replaceState(null, '', location.pathname + location.search);
  const d = state?.person.devices.find((x) => x.id === id);
  if (d && !d.handshake && !d.disabled && !state?.locked) void setup(d);
}

async function refresh() {
  try {
    state = await call<State>('state');
    document.title = `${state.person.name} · ${state.title}`;
    if (!sheetEl && !menuEl) main(state);
    openFromLink();
  } catch (e) {
    const er = e as ApiError;
    if (er.status === 404 || er.status === 401) {
      state = null;
      linkGone();
    }
    // A network hiccup: keep showing the last state (the page loads fresh data on reload).
    else if (!state) shell(h('div', { class: 'card' }, h('p', {}, er.message)));
  }
}

// No periodic refresh: every portal request runs a CGI process on the router.
// The page reloads its data after the visitor's own changes and while it waits
// for a new device's first connection.
if (!base || !code) linkGone();
else void refresh();
